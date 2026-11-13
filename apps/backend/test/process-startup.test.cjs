const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtemp, writeFile, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { resolve, sep } = require("node:path");
const { once } = require("node:events");
const { MongoMemoryServer } = require("mongodb-memory-server");
let directory, memory, main, db, server, origin, cookie, rowsFile, project, startup, pm2;
const started = [], validated = [];
let failStart = false;
const rows = [1, 2, 3].map(id => ({ pm_id: id, name: "app", pm2_env: { status: "stopped", namespace: id === 3 ? "other" : "default" } }));
before(async () => {
  directory = await mkdtemp(resolve(tmpdir(), "monitor-startup-"));
  memory = await MongoMemoryServer.create();
  rowsFile = resolve(directory, "rows.json");
  await writeFile(rowsFile, JSON.stringify(rows));
  const cli = resolve(directory, "pm2.cjs");
  await writeFile(cli, `if(process.argv[2]==='jlist')console.log(require('node:fs').readFileSync(${JSON.stringify(rowsFile)},'utf8'));`);
  Object.assign(process.env, { MONGODB_URI: memory.getUri(), MONGODB_DATABASE: "startup_tests",
    ADMIN_USERNAME: "admin", ADMIN_PASSWORD: "startup-password-12345", JWT_SECRET: "startup-test-secret-at-least-thirty-two-characters",
    VERSIONS_DIR: resolve(directory, "versions"), PM2_HOME: resolve(directory, "pm2"), PM2_SCRIPT: cli });
  main = require("../dist/main"); db = require("../dist/common/database"); pm2 = require("../dist/pm2/pm2.service");
  pm2.validateStartupProcess = async (...args) => { validated.push(args); };
  pm2.startSelectedProcess = async (...args) => { if (failStart) throw new Error("startup failure"); started.push(args); };
  startup = require("../dist/pm2/process-startup");
  await main.initialize();
  server = main.app.listen(0, "127.0.0.1"); await once(server, "listening");
  origin = `http://127.0.0.1:${server.address().port}`;
}, { timeout: 120000 });
after(async () => {
  if (server) await new Promise(done => server.close(done));
  await main?.flushAudit(); await db?.mongo.close(); await memory?.stop();
  if (directory?.startsWith(resolve(tmpdir()) + sep) && directory.includes("monitor-startup-"))
    await rm(directory, { recursive: true, force: true, maxRetries: 10 });
});
const request = (path, method = "GET", body) => fetch(origin + path, { method,
  headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const put = (id, enabled, extra = {}) => request(`/api/processes/${encodeURIComponent(id)}/settings`, "PUT", { name: "app", namespace: "default", autoStart: enabled, ...extra });
const list = async () => (await request("/api/processes")).json();

test("startup settings authenticate, validate identity and require a project without starting processes on save", async () => {
  assert.equal((await put(1, true)).status, 401);
  const login = await request("/api/auth/login", "POST", { username: "admin", password: "startup-password-12345" });
  cookie = login.headers.get("set-cookie").split(";")[0];
  assert.equal((await put(1, "yes")).status, 400);
  assert.equal((await put(1, true, { name: "wrong" })).status, 409);
  assert.equal((await put(1, true)).status, 400);
  project = await (await request("/api/projects", "POST", { name: "Startup", rootPath: resolve(directory, "application") })).json();
  await writeFile(resolve(project.rootPath, "ecosystem.config.js"), "module.exports={apps:[{name:'app',script:'./main.js'}]};");
  rows.forEach(row => { row.pm2_env.pm_cwd = project.rootPath; row.pm2_env.pm_exec_path = resolve(project.rootPath, "main.js"); });
  await writeFile(rowsFile, JSON.stringify(rows));
  const saved = await put(1, true);
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).autoStart, true);
  assert.equal(started.length, 0);
  assert.equal(validated.length, 1);
  assert.equal(await db.processStartup.countDocuments(), 1);
  const snapshot = await list();
  assert.ok(snapshot.filter(row => [1, 2].includes(row.id)).every(row => row.autoStart));
  assert.equal(snapshot.find(row => row.id === 3).autoStart, false);
});

test("deleting a process cannot race with enabling its startup preference", async () => {
  const validate = pm2.validateStartupProcess;
  let release, entered;
  const validating = new Promise(resolve => { entered = resolve; });
  pm2.validateStartupProcess = async () => { entered(); await new Promise(resolve => { release = resolve; }); };
  const saving = put(1, true);
  try {
    await validating;
    assert.equal((await request("/api/processes/1/delete", "POST", { name: "app", namespace: "default" })).status, 409);
  } finally { release?.(); pm2.validateStartupProcess = validate; }
  assert.equal((await saving).status, 200);
});

test("startup preferences survive PM2 IDs, remain editable for absent processes and obey operation locks", async () => {
  rows[0].pm_id = 9; await writeFile(rowsFile, JSON.stringify(rows));
  assert.equal((await list()).find(row => row.id === 9).autoStart, true);
  await writeFile(rowsFile, "[]");
  const missing = (await list()).find(row => row.namespace === "default");
  assert.equal(missing.autoStart, true);
  const settings = await request(`/api/processes/${encodeURIComponent(missing.id)}/settings?name=app&namespace=default`);
  assert.equal((await settings.json()).canAutoStart, true);
  const { withProjectOperation } = require("../dist/projects/project-operations");
  const { ObjectId } = require("mongodb");
  await withProjectOperation(new ObjectId(project._id), async () => assert.equal((await put(missing.id, true)).status, 409));
  assert.equal((await put(missing.id, false)).status, 200);
  await startup.startConfiguredProcesses(); assert.equal(started.length, 0);
  assert.equal((await put(missing.id, true)).status, 200);
  await startup.startConfiguredProcesses();
  assert.deepEqual(started[0], [resolve(project.rootPath, "ecosystem.config.js"), project.rootPath, "app", "default"]);
  assert.equal(started.length, 1, "Only the selected identity is started, not the whole ecosystem");
});

test("startup errors are visible and recovery failures or changed links suppress startup", async () => {
  failStart = true;
  await startup.startConfiguredProcesses();
  assert.match((await list()).find(row => row.namespace === "default").autoStartError, /startup failure/);
  failStart = false;
  const { ObjectId } = require("mongodb");
  const id = new ObjectId(project._id);
  await db.projects.updateOne({ _id: id }, { $set: { deploymentError: "recovery needed" } });
  await startup.startConfiguredProcesses(); assert.equal(started.length, 1);
  await db.projects.updateOne({ _id: id }, { $unset: { deploymentError: "" } });
  await writeFile(rowsFile, JSON.stringify(rows));
  assert.equal((await request("/api/processes/9/project", "PUT", { name: "app", namespace: "default", projectId: null })).status, 200);
  await startup.startConfiguredProcesses(); assert.equal(started.length, 1);
  assert.equal((await list()).find(row => row.id === 9).autoStart, false);
});
