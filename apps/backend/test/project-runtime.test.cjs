const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtemp, writeFile, readFile, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { resolve, sep } = require("node:path");
const { once } = require("node:events");
const { MongoMemoryServer } = require("mongodb-memory-server");
let directory, memory, main, db, server, origin, cookie, rowsFile, resultFile, callsFile, project;
before(async () => {
  directory = await mkdtemp(resolve(tmpdir(), "monitor-runtime-"));
  memory = await MongoMemoryServer.create();
  rowsFile = resolve(directory, "rows.json");
  resultFile = resolve(directory, "result.json");
  callsFile = resolve(directory, "calls.jsonl");
  await writeFile(rowsFile, "[]");
  await writeFile(resultFile, "[]");
  const cli = resolve(directory, "pm2.cjs");
  await writeFile(cli, `const fs=require('node:fs');const args=process.argv.slice(2);
    if(args[0]==='jlist') console.log(fs.readFileSync(${JSON.stringify(rowsFile)},'utf8'));
    else {fs.appendFileSync(${JSON.stringify(callsFile)},JSON.stringify(args)+'\\n');
      if(args[0]==='start') fs.copyFileSync(${JSON.stringify(resultFile)},${JSON.stringify(rowsFile)});}`);
  Object.assign(process.env, {
    MONGODB_URI: memory.getUri(), MONGODB_DATABASE: "runtime_tests",
    ADMIN_USERNAME: "admin", ADMIN_PASSWORD: "runtime-password-12345",
    JWT_SECRET: "runtime-test-secret-at-least-thirty-two-characters",
    VERSIONS_DIR: resolve(directory, "versions"), PM2_HOME: resolve(directory, "pm2"), PM2_SCRIPT: cli,
  });
  main = require("../dist/main"); db = require("../dist/common/database");
  await main.initialize();
  server = main.app.listen(0, "127.0.0.1"); await once(server, "listening");
  origin = `http://127.0.0.1:${server.address().port}`;
}, { timeout: 120000 });
after(async () => {
  if (server) await new Promise(done => server.close(done));
  await main?.flushAudit(); await db?.mongo.close(); await memory?.stop();
  if (directory?.startsWith(resolve(tmpdir()) + sep) && directory.includes("monitor-runtime-"))
    await rm(directory, { recursive: true, force: true, maxRetries: 10 });
});
const request = (path, method = "GET", body) => fetch(origin + path, {
  method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const list = async () => (await request("/api/processes")).json();
const row = (id, name, status = "online") => ({ pm_id: id, name, pid: 0,
  pm2_env: { status, namespace: "default", pm_cwd: project.rootPath, pm_exec_path: "main.js" } });

test("local start requires a session and an existing ecosystem; new projects appear unstarted", async () => {
  assert.equal((await request("/api/projects/111111111111111111111111/start", "POST")).status, 401);
  assert.equal((await request("/api/logs/applications")).status, 401);
  const login = await request("/api/auth/login", "POST", { username: "admin", password: "runtime-password-12345" });
  cookie = login.headers.get("set-cookie").split(";")[0];
  const created = await request("/api/projects", "POST", { name: "Runtime", rootPath: resolve(directory, "application"), applicationUrl: "https://example.test/app" });
  assert.equal(created.status, 201); project = await created.json();
  const [missing] = await list();
  assert.equal(missing.status, "not_started");
  assert.equal(missing.startProjectId, project._id);
  assert.equal(missing.applicationUrl, "https://example.test/app");
  assert.equal((await request(`/api/projects/${project._id}/start`, "POST")).status, 404);
  await assert.rejects(readFile(callsFile), { code: "ENOENT" });
});

test("start uses only local files and validates PM2 instead of reporting false success", async () => {
  const ecosystem = resolve(project.rootPath, "ecosystem.config.js");
  await writeFile(ecosystem, "module.exports = { apps: [{ name: 'api', script: './main.js' }] };\n");
  await writeFile(resolve(project.rootPath, "main.js"), "local application");
  const original = await readFile(ecosystem, "utf8");
  assert.equal((await request(`/api/projects/${project._id}/start`, "POST")).status, 502);
  await writeFile(resultFile, JSON.stringify([row(1, "api"), row(2, "worker")]));
  assert.equal((await request(`/api/projects/${project._id}/start`, "POST")).status, 200);
  assert.equal(await readFile(ecosystem, "utf8"), original);
  assert.equal(await readFile(resolve(project.rootPath, "main.js"), "utf8"), "local application");
  assert.equal(await db.projectBuilds.countDocuments(), 0);
  const calls = (await readFile(callsFile, "utf8")).trim().split("\n").map(JSON.parse);
  assert.deepEqual(calls, [["start", ecosystem], ["save", "--force"], ["start", ecosystem], ["save", "--force"]]);
});

test("missing identities survive new PM2 IDs and partial starts stay visible", async () => {
  const { processScope } = require("../dist/pm2/process-projects");
  await db.processLabels.insertOne({ scope: processScope(), name: "worker", namespace: "default", label: "Fila", createdAt: new Date(), updatedAt: new Date(), updatedBy: "admin" });
  await writeFile(rowsFile, JSON.stringify([row(9, "api")]));
  let rows = await list();
  assert.equal(rows.find(item => item.name === "api").id, 9);
  assert.equal(rows.find(item => item.name === "worker").status, "not_started");
  assert.equal(rows.find(item => item.name === "worker").label, "Fila");
  await writeFile(resultFile, JSON.stringify([row(9, "api")]));
  assert.equal((await request(`/api/projects/${project._id}/start`, "POST")).status, 502);
  await writeFile(resultFile, JSON.stringify([row(10, "api"), row(11, "worker")]));
  assert.equal((await request(`/api/projects/${project._id}/start`, "POST")).status, 200);
  rows = await list();
  assert.equal(rows.length, 2);
  assert.ok(rows.every(item => item.status === "online" && !item.startProjectId));
  await writeFile(rowsFile, "[]");
  assert.equal((await list()).filter(item => item.status === "not_started").length, 2);
});

test("project URLs validate schemes, preserve omitted values and support removal", async () => {
  const fields = { name: project.name, rootPath: project.rootPath };
  for (const url of ["javascript:alert(1)", "file:///etc/passwd", "https://user:pass@example.test", "invalid", 4])
    assert.equal((await request(`/api/projects/${project._id}`, "PUT", { ...fields, applicationUrl: url })).status, 400);
  const saved = await (await request(`/api/projects/${project._id}`, "PUT", fields)).json();
  assert.equal(saved.applicationUrl, project.applicationUrl);
  const cleared = await (await request(`/api/projects/${project._id}`, "PUT", { ...fields, applicationUrl: "" })).json();
  assert.equal(cleared.applicationUrl, "");
});

test("local starts respect project and publication locks", async () => {
  const { ObjectId } = require("mongodb");
  const { withProjectOperation } = require("../dist/projects/project-operations");
  await withProjectOperation(new ObjectId(project._id), async () => {
    assert.equal((await request(`/api/projects/${project._id}/start`, "POST")).status, 409);
  });
  const progress = require("../dist/projects/build-progress");
  const operation = progress.createBuildOperation(project._id, "admin", project.name);
  assert.equal((await request(`/api/projects/${project._id}/start`, "POST")).status, 409);
  progress.cancelBuildOperation(progress.getBuildOperation(operation.id, project._id, "admin"));
});

test("saved log applications include historical names and filters survive ID changes", async () => {
  await db.logs.insertMany([
    { kind: "process", processId: 1, processName: "api", content: "old", createdAt: new Date() },
    { kind: "process", processId: 9, processName: "api", content: "new", createdAt: new Date() },
    { kind: "process", processId: 1, processName: "other", content: "unrelated", createdAt: new Date() },
  ]);
  assert.deepEqual(await (await request("/api/logs/applications")).json(), [{ name: "api" }, { name: "other" }]);
  const logs = await (await request("/api/logs?kind=process&processName=api")).json();
  assert.equal(logs.length, 2); assert.ok(logs.every(log => log.processName === "api"));
});
