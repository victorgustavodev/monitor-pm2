const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtemp, writeFile, readFile, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { resolve, sep } = require("node:path");
const { once } = require("node:events");
const { MongoMemoryServer } = require("mongodb-memory-server");
let directory, memory, main, db, server, origin, cookie, rowsPath, mutationPath;
const rows = [7, 8, 9].map((id) => ({
  pm_id: id,
  name: "processText3920",
  pid: 0,
  pm2_env: {
    status: "stopped",
    namespace: id === 8 ? "other" : "default",
    PORT: "3000",
  },
}));
before(
  async () => {
    directory = await mkdtemp(resolve(tmpdir(), "monitor-project-links-"));
    memory = await MongoMemoryServer.create();
    rowsPath = resolve(directory, "rows.json");
    mutationPath = resolve(directory, "mutations.txt");
    await writeFile(rowsPath, JSON.stringify(rows));
    const cli = resolve(directory, "pm2.cjs");
    await writeFile(
      cli,
      `const fs=require('node:fs');if(process.argv[2]==='jlist')console.log(fs.readFileSync(${JSON.stringify(rowsPath)},'utf8'));else fs.appendFileSync(${JSON.stringify(mutationPath)},process.argv.slice(2).join(' '));`,
    );
    Object.assign(process.env, {
      MONGODB_URI: memory.getUri(),
      MONGODB_DATABASE: "project_link_tests",
      ADMIN_USERNAME: "admin",
      ADMIN_PASSWORD: "label-password-12345",
      JWT_SECRET: "labels-test-secret-at-least-thirty-two-characters",
      VERSIONS_DIR: resolve(directory, "versions"),
      PM2_HOME: resolve(directory, "pm2"),
      PM2_SCRIPT: cli,
    });
    main = require("../dist/main");
    db = require("../dist/common/database");
    await main.initialize();
    server = main.app.listen(0, "127.0.0.1");
    await once(server, "listening");
    origin = `http://127.0.0.1:${server.address().port}`;
  },
  { timeout: 120000 },
);
after(async () => {
  if (server) await new Promise((done) => server.close(done));
  await main?.flushAudit();
  await db?.mongo.close();
  await memory?.stop();
  if (
    directory?.startsWith(resolve(tmpdir()) + sep) &&
    directory.includes("monitor-project-links-")
  )
    await rm(directory, { recursive: true, force: true, maxRetries: 10 });
});
const request = (path, options = {}) =>
  fetch(origin + path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...options.headers,
    },
  });

let projectA, projectB;
const save = (id, projectId, identity = {}) => request(`/api/processes/${id}/project`, {
  method: "PUT", body: JSON.stringify({ name: "processText3920", namespace: "default", projectId, ...identity }),
});
const list = async () => (await request("/api/processes")).json();

test("project links require authentication and automatically identify the project's processes by path", async () => {
  assert.equal((await save(7, null)).status, 401);
  const login = await request("/api/auth/login", { method: "POST", body: JSON.stringify({ username: "admin", password: "label-password-12345" }) });
  cookie = login.headers.get("set-cookie").split(";")[0];
  async function create(name) {
    const response = await request("/api/projects", { method: "POST", body: JSON.stringify({ name, rootPath: resolve(directory, name) }) });
    assert.equal(response.status, 201);
    return response.json();
  }
  projectA = await create("Project A");
  projectB = await create("Project B");
  for (const row of rows) Object.assign(row.pm2_env, {
    pm_cwd: row.pm_id === 8 ? resolve(directory, "external") : projectA.rootPath,
    pm_exec_path: "main.js",
  });
  await writeFile(rowsPath, JSON.stringify(rows));
  const result = await list();
  assert.equal(result.find(row => row.id === 7).projectId, projectA._id);
  assert.equal(result.find(row => row.id === 9).projectName, "Project A");
  assert.equal(result.find(row => row.id === 8).projectId, null);
});

test("manual links persist for cluster instances, isolate namespaces and override path inference without PM2 mutations", async () => {
  const response = await save(7, projectB._id);
  assert.equal(response.status, 200);
  const saved = await response.json();
  assert.equal(saved.projectName, "Project B");
  assert.ok(saved.projectUpdatedAt);
  const result = await list();
  assert.equal(result.find(row => row.id === 7).projectId, projectB._id);
  assert.equal(result.find(row => row.id === 9).projectId, projectB._id);
  assert.equal(result.find(row => row.id === 8).projectId, null);
  assert.deepEqual((await (await request(`/api/projects/${projectB._id}/deletion-preview`)).json()).processes.map(row => row.id), [7, 9]);
  assert.deepEqual((await (await request(`/api/projects/${projectA._id}/deletion-preview`)).json()).processes, []);
  assert.equal((await db.processProjects.findOne({ name: "processText3920" })).updatedBy, "admin");
  await assert.rejects(readFile(mutationPath), { code: "ENOENT" });
});

test("invalid projects, deleting projects and stale process identities cannot be linked", async () => {
  for (const value of [undefined, 42, "", "bad-id"]) assert.equal((await save(7, value)).status, 400);
  assert.equal((await save(7, "123456789012345678901234")).status, 404);
  assert.equal((await save(7, projectA._id, { name: "different" })).status, 409);
  assert.equal((await save(7, projectA._id, { namespace: "other" })).status, 409);
  assert.equal((await save(77, projectA._id)).status, 404);
  const { ObjectId } = require("mongodb");
  await db.projects.updateOne({ _id: new ObjectId(projectA._id) }, { $set: { deleting: true } });
  assert.equal((await save(7, projectA._id)).status, 409);
  await db.projects.updateOne({ _id: new ObjectId(projectA._id) }, { $unset: { deleting: "" } });
});

test("project SSE includes links, renames propagate and clearing remains unlinked despite a matching path", async () => {
  const renamed = await request(`/api/projects/${projectB._id}`, { method: "PUT", body: JSON.stringify({ name: "Renamed B", rootPath: projectB.rootPath }) });
  assert.equal(renamed.status, 200);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await request("/api/processes/stream", { signal: controller.signal });
    const reader = response.body.getReader();
    let content = "";
    while (!content.includes("event: processes") || !content.slice(content.indexOf("event: processes")).includes("\n\n"))
      content += new TextDecoder().decode((await reader.read()).value);
    const frame = JSON.parse(content.split("event: processes\ndata: ")[1].split("\n\n")[0]);
    assert.equal(frame.find(row => row.id === 7).projectName, "Renamed B");
  } finally { clearTimeout(timeout); controller.abort(); }
  const cleared = await (await save(7, null)).json();
  assert.equal(cleared.projectId, null);
  assert.ok(cleared.projectUpdatedAt);
  assert.equal((await list()).find(row => row.id === 7).projectId, null);
});

test("links survive changing PM2 IDs, never transfer to a different identity and are cleared when a project is deleted", async () => {
  await save(7, projectB._id);
  rows[0].pm_id = 17;
  rows.push({ pm_id: 7, name: "another-app", pid: 0, pm2_env: { namespace: "default", status: "stopped", pm_cwd: resolve(directory, "external"), pm_exec_path: "main.js" } });
  await writeFile(rowsPath, JSON.stringify(rows));
  assert.equal((await list()).find(row => row.id === 17).projectId, projectB._id);
  assert.equal((await list()).find(row => row.id === 7).projectId, null);
  assert.equal((await save(7, projectB._id)).status, 409);
  const preview = await (await request(`/api/projects/${projectB._id}/deletion-preview`)).json();
  await save(17, null);
  const stale = await request(`/api/projects/${projectB._id}`, { method: "DELETE", body: JSON.stringify({ stopProcesses: true, processRevision: preview.revision }) });
  assert.equal(stale.status, 409);
  await save(17, projectB._id);
  assert.equal((await request(`/api/projects/${projectB._id}`, { method: "DELETE" })).status, 204);
  assert.equal((await list()).find(row => row.id === 17).projectId, null);
  assert.equal((await db.processProjects.findOne({ namespace: "default", name: "processText3920" })).projectId, null);
  await assert.rejects(readFile(mutationPath), { code: "ENOENT" });
});

test("regular operators can link a process outside a project root and deletion stops exactly the linked process", async () => {
  await request("/api/users", { method: "POST", body: JSON.stringify({ username: "operator", password: "operator-password-12345" }) });
  const login = await request("/api/auth/login", { method: "POST", body: JSON.stringify({ username: "operator", password: "operator-password-12345" }) });
  cookie = login.headers.get("set-cookie").split(";")[0];
  assert.equal((await save(8, projectA._id, { namespace: "other" })).status, 200);
  const preview = await (await request(`/api/projects/${projectA._id}/deletion-preview`)).json();
  assert.deepEqual(preview.processes.map(row => row.id), [8]);
  const response = await request(`/api/projects/${projectA._id}`, { method: "DELETE", body: JSON.stringify({ stopProcesses: true, processRevision: preview.revision }) });
  assert.equal(response.status, 204);
  assert.equal(await readFile(mutationPath, "utf8"), "stop 8save --force");
});
