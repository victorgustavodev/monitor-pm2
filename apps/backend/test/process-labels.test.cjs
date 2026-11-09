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
    directory = await mkdtemp(resolve(tmpdir(), "monitor-labels-"));
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
      MONGODB_DATABASE: "label_tests",
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
    directory.includes("monitor-labels-")
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
const save = (id, label, identity = {}) =>
  request(`/api/processes/${id}/label`, {
    method: "PUT",
    body: JSON.stringify({
      name: "processText3920",
      namespace: "default",
      label,
      ...identity,
    }),
  });
test("labels require authentication, persist shared names, and do not rename or restart PM2 processes", async () => {
  assert.equal((await save(7, "workTabs")).status, 401);
  const login = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      username: "admin",
      password: "label-password-12345",
    }),
  });
  cookie = login.headers.get("set-cookie").split(";")[0];
  const response = await save(7, "  workTabs  ");
  assert.equal(response.status, 200);
  const saved = await response.json();
  assert.equal(saved.label, "workTabs");
  assert.ok(saved.labelUpdatedAt);
  const processes = await (await request("/api/processes")).json();
  assert.equal(processes.find((row) => row.id === 7).label, "workTabs");
  assert.equal(processes.find((row) => row.id === 9).label, "workTabs");
  assert.equal(processes.find((row) => row.id === 8).label, "");
  assert.equal(processes.find((row) => row.id === 7).name, "processText3920");
  const record = await db.processLabels.findOne({
    name: "processText3920",
    namespace: "default",
  });
  assert.equal(record.updatedBy, "admin");
  assert.equal(record.label, "workTabs");
  await assert.rejects(readFile(mutationPath), { code: "ENOENT" });
});
test("label validation rejects invalid input and stale process identities", async () => {
  for (const label of [42, null, "x".repeat(81), "work\nTabs"])
    assert.equal((await save(7, label)).status, 400);
  assert.equal((await save(7, "name", { name: "different" })).status, 409);
  assert.equal((await save(7, "name", { namespace: "other" })).status, 409);
  assert.equal((await save(77, "name")).status, 404);
  assert.equal((await save(-1, "name")).status, 400);
});
test("process SSE snapshots include saved labels", async () => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await request("/api/processes/stream", {
      signal: controller.signal,
    });
    const reader = response.body.getReader();
    let content = "";
    while (
      !content.includes("event: processes") ||
      !content.slice(content.indexOf("event: processes")).includes("\n\n")
    )
      content += new TextDecoder().decode((await reader.read()).value);
    const frame = JSON.parse(
      content.split("event: processes\ndata: ")[1].split("\n\n")[0],
    );
    assert.equal(frame.find((row) => row.id === 7).label, "workTabs");
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
});
test("labels survive a new PM2 ID, isolate namespaces, and can be cleared", async () => {
  rows[0].pm_id = 17;
  rows.push({
    pm_id: 7,
    name: "another-app",
    pid: 0,
    pm2_env: { namespace: "default", status: "stopped" },
  });
  await writeFile(rowsPath, JSON.stringify(rows));
  const processes = await (await request("/api/processes")).json();
  assert.equal(processes.find((row) => row.id === 17).label, "workTabs");
  assert.equal(processes.find((row) => row.id === 7).label, "");
  assert.equal((await save(7, "wrong app")).status, 409);
  const cleared = await (await save(17, "")).json();
  assert.equal(cleared.label, "");
  assert.ok(cleared.labelUpdatedAt);
  assert.equal(
    (await (await request("/api/processes")).json()).find(
      (row) => row.id === 17,
    ).label,
    "",
  );
  assert.equal(
    await db.processLabels.countDocuments({
      namespace: "default",
      name: "processText3920",
    }),
    1,
  );
});
test("regular authenticated operators can save a shared process label", async () => {
  await request("/api/users", {
    method: "POST",
    body: JSON.stringify({
      username: "operator",
      password: "operator-password-12345",
    }),
  });
  const login = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      username: "operator",
      password: "operator-password-12345",
    }),
  });
  const operatorCookie = login.headers.get("set-cookie").split(";")[0];
  const response = await request("/api/processes/17/label", {
    method: "PUT",
    headers: { cookie: operatorCookie },
    body: JSON.stringify({
      name: "processText3920",
      namespace: "default",
      label: "workTabs operator",
    }),
  });
  assert.equal(response.status, 200);
  assert.equal(
    (
      await db.processLabels.findOne({
        namespace: "default",
        name: "processText3920",
      })
    ).updatedBy,
    "operator",
  );
});
