const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
} = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { resolve, sep } = require("node:path");
const { once } = require("node:events");
const { ObjectId } = require("mongodb");
const { MongoMemoryServer } = require("mongodb-memory-server");
let directory,
  memory,
  db,
  main,
  server,
  origin,
  cookie,
  runRetention,
  lock,
  pm2;
let paths = [],
  pm2Failure = false;
const now = new Date("2035-01-01T00:00:00Z");
const old = new Date("2034-01-01T00:00:00Z");
before(
  async () => {
    directory = await mkdtemp(resolve(tmpdir(), "monitor-retention-"));
    memory = await MongoMemoryServer.create();
    Object.assign(process.env, {
      MONGODB_URI: memory.getUri(),
      MONGODB_DATABASE: "retention_tests",
      JWT_SECRET: "retention-test-secret-more-than-thirty-two-characters",
      ADMIN_USERNAME: "admin",
      ADMIN_PASSWORD: "test-password-12345",
      VERSIONS_DIR: resolve(directory, "archives"),
      PM2_HOME: resolve(directory, "pm2"),
    });
    pm2 = require("../dist/pm2/pm2.service");
    pm2.processArtifactPaths = async () => {
      if (pm2Failure) throw new Error("PM2 indisponível");
      return paths;
    };
    main = require("../dist/main");
    db = require("../dist/common/database");
    ({ runRetention } = require("../dist/settings/retention.service"));
    lock = require("../dist/common/artifact-access");
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
    directory.includes("monitor-retention-")
  )
    await rm(directory, { recursive: true, force: true, maxRetries: 10 });
});
const request = (method, body, auth = true) =>
  fetch(`${origin}/api/settings/retention`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(auth && cookie ? { cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
async function due() {
  await db.retentionSettings.updateOne(
    { _id: "retention" },
    {
      $set: {
        enabled: true,
        retentionDays: 30,
        intervalHours: 24,
        updatedAt: old,
      },
      $unset: { lastRunAt: "" },
    },
  );
}
async function version(name, status = "ready", createdAt = old) {
  const _id = new ObjectId();
  const folder = resolve(directory, "archives", _id.toHexString());
  await mkdir(folder, { recursive: true });
  await writeFile(resolve(folder, "sentinel.txt"), name);
  await db.versions.insertOne({
    _id,
    project: "cleanup",
    version: name,
    status,
    createdAt,
    originalName: "build.zip",
    size: 1,
    sha256: "test",
    createdBy: "admin",
  });
  return { _id, folder };
}
test("retention is disabled by default and settings accept only an age in days", async () => {
  assert.equal((await request("GET", undefined, false)).status, 401);
  const login = await fetch(`${origin}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: "admin",
      password: "test-password-12345",
    }),
  });
  cookie = login.headers.get("set-cookie").split(";")[0];
  const settings = await (await request("GET")).json();
  assert.equal(settings.enabled, false);
  assert.equal(settings.intervalHours, undefined);
  assert.equal(settings.nextRunAt, undefined);
  assert.equal(await runRetention(now), false);
  for (const body of [
    { enabled: "true", retentionDays: 30, intervalHours: 24 },
    { enabled: true, retentionDays: 0, intervalHours: 24 },
    { enabled: true, retentionDays: 1.5 },
    { enabled: true, retentionDays: 3651, intervalHours: 24 },
  ])
    assert.equal((await request("PUT", body)).status, 400);
  assert.equal(
    (
      await request("PUT", {
        enabled: true,
        retentionDays: 30,
        intervalHours: 24,
      })
    ).status,
    200,
  );
  const stored = await (await request("GET")).json();
  assert.equal(stored.updatedBy, "admin");
  assert.equal(stored.intervalHours, undefined);
  assert.equal(stored.nextRunAt, undefined);
  assert.equal((await db.retentionSettings.findOne({ _id: "retention" })).intervalHours, undefined);
  assert.equal(await runRetention(new Date(stored.updatedAt)), false);
});
test("versions expire at their own upload time plus seven days, independently of saved settings and legacy intervals", async () => {
  const uploadedAt = new Date("2030-02-01T15:23:45Z");
  const expiresAt = new Date("2030-02-08T15:23:45Z");
  const first = await version("seven-days", "ready", uploadedAt);
  const later = await version("later-upload", "ready", new Date("2030-02-02T15:23:45Z"));
  const projectId = new ObjectId(), buildId = new ObjectId();
  await db.projects.insertOne({ _id: projectId, nameKey: "age-boundary", rootKey: "age-boundary" });
  const folder = resolve(directory, "archives/projects", projectId.toHexString(), buildId.toHexString());
  await mkdir(folder, { recursive: true });
  await writeFile(resolve(folder, "sentinel.txt"), "project build");
  await db.projectBuilds.insertOne({ _id: buildId, projectId, nameKey: "seven-days", createdAt: uploadedAt, deployedAt: new Date("2030-02-07T12:00:00Z"), status: "deployed" });
  await request("PUT", { enabled: true, retentionDays: 7 });
  // Old persisted intervals and recent saves/runs must not postpone expiration.
  await db.retentionSettings.updateOne({ _id: "retention" }, { $set: { intervalHours: 8760, updatedAt: expiresAt, lastRunAt: new Date(expiresAt.getTime() - 1) } });
  assert.equal(await runRetention(new Date(expiresAt.getTime() - 1)), false);
  assert.ok(await db.versions.findOne({ _id: first._id }));
  assert.ok(await db.projectBuilds.findOne({ _id: buildId }));
  assert.equal(await runRetention(expiresAt), true);
  assert.equal(await db.versions.findOne({ _id: first._id }), null);
  assert.equal(await db.projectBuilds.findOne({ _id: buildId }), null);
  await assert.rejects(readFile(resolve(folder, "sentinel.txt")), { code: "ENOENT" });
  assert.ok(await db.versions.findOne({ _id: later._id }));
  await request("PUT", { enabled: false, retentionDays: 7 });
  assert.equal(await runRetention(new Date("2030-02-10T00:00:00Z")), false);
  assert.ok(await db.versions.findOne({ _id: later._id }));
  // Re-enabling catches up with expired versions without starting another seven days.
  await request("PUT", { enabled: true, retentionDays: 7 });
  assert.equal(await runRetention(new Date("2030-02-10T00:00:00Z")), true);
  assert.equal(await db.versions.findOne({ _id: later._id }), null);
});

test("cleanup removes expired artifacts while preserving active, recent, processing, PM2 and recovery files", async () => {
  const expired = await version("expired");
  const recent = await version("recent", "ready", now);
  const processing = await version("processing", "processing");
  const referenced = await version("stopped-but-referenced", "started");
  paths = [resolve(referenced.folder, "build/app.js")];
  const projectId = new ObjectId(),
    activeId = new ObjectId(),
    staleId = new ObjectId(),
    pendingId = new ObjectId(),
    recoveryId = new ObjectId();
  const rootPath = resolve(directory, "application");
  await mkdir(rootPath);
  await writeFile(resolve(rootPath, "live.txt"), "live");
  await db.projects.insertMany([
    {
      _id: projectId,
      name: "Live",
      nameKey: "live",
      rootKey: rootPath,
      rootPath,
      activeBuildId: activeId,
    },
    {
      _id: pendingId,
      name: "Recovery",
      nameKey: "recovery",
      rootKey: "recovery",
      rootPath,
      deployment: { buildId: recoveryId, attemptId: "pending" },
    },
  ]);
  for (const [id, owner] of [
    [activeId, projectId],
    [staleId, projectId],
    [recoveryId, pendingId],
  ]) {
    const folder = resolve(
      directory,
      "archives/projects",
      owner.toHexString(),
      id.toHexString(),
    );
    await mkdir(folder, { recursive: true });
    await writeFile(resolve(folder, "sentinel.txt"), "build");
    await db.projectBuilds.insertOne({
      _id: id,
      projectId: owner,
      name: id.toHexString(),
      nameKey: id.toHexString(),
      createdAt: old,
      status: "deployed",
      extracted: true,
      archiveReady: true,
    });
  }
  await due();
  assert.equal(await runRetention(now), true);
  assert.equal(await db.versions.findOne({ _id: expired._id }), null);
  await assert.rejects(readFile(resolve(expired.folder, "sentinel.txt")), {
    code: "ENOENT",
  });
  for (const entry of [recent, processing, referenced])
    assert.ok(await db.versions.findOne({ _id: entry._id }));
  assert.equal(await db.projectBuilds.findOne({ _id: staleId }), null);
  assert.ok(await db.projectBuilds.findOne({ _id: activeId }));
  assert.ok(await db.projectBuilds.findOne({ _id: recoveryId }));
  assert.equal(await readFile(resolve(rootPath, "live.txt"), "utf8"), "live");
  assert.equal(
    (await db.retentionSettings.findOne({ _id: "retention" })).lastDeleted,
    2,
  );
  const auditCount = await db.logs.countDocuments({ method: "RETENTION" });
  assert.equal(await runRetention(now), true);
  assert.equal((await db.retentionSettings.findOne({ _id: "retention" })).lastDeleted, 0);
  assert.ok(await db.projectBuilds.findOne({ _id: activeId }));
  assert.equal(await db.logs.countDocuments({ method: "RETENTION" }), auditCount);
});
test("PM2 failure prevents deletion and disabling cleanup cancels future runs", async () => {
  const entry = await version("pm2-unavailable");
  await due();
  pm2Failure = true;
  await runRetention(now);
  assert.ok(await db.versions.findOne({ _id: entry._id }));
  assert.match(
    (await db.retentionSettings.findOne({ _id: "retention" })).lastError,
    /PM2/,
  );
  pm2Failure = false;
  await request("PUT", {
    enabled: false,
    retentionDays: 30,
    intervalHours: 24,
  });
  assert.equal(await runRetention(now), false);
});
test("saved PM2 lists and backup lists preserve paths needed for resurrection", async () => {
  const {
    savedArtifactPaths,
    collectArtifactPaths,
  } = require("../dist/pm2/artifact-paths");
  const home = resolve(directory, "saved-pm2");
  await mkdir(home);
  const app = resolve(directory, "saved-app");
  await writeFile(
    resolve(home, "dump.pm2"),
    JSON.stringify([{ pm_cwd: app, pm_exec_path: "main.js" }]),
  );
  await writeFile(
    resolve(home, "dump.pm2.bak"),
    JSON.stringify([{ pm_cwd: resolve(app, "older"), pm_exec_path: "old.js" }]),
  );
  const protectedPaths = await savedArtifactPaths(home);
  assert.ok(protectedPaths.includes(resolve(app, "main.js")));
  assert.ok(protectedPaths.includes(resolve(app, "older/old.js")));
  assert.throws(() => collectArtifactPaths([{}]), /limpeza adiada/);
  await writeFile(resolve(home, "dump.pm2"), "invalid json");
  await assert.rejects(savedArtifactPaths(home));
});
test("cleanup cannot overlap publications and rejects new operations until it finishes", async () => {
  await due();
  await lock.withArtifactAccess(async () =>
    assert.equal(await runRetention(now), false),
  );
  await lock.tryArtifactCleanup(async () => {
    await assert.rejects(
      lock.withArtifactAccess(async () => {}),
      (error) => error.status === 409,
    );
    assert.equal(await runRetention(now), false);
    assert.equal(
      (
        await request("PUT", {
          enabled: true,
          retentionDays: 30,
          intervalHours: 24,
        })
      ).status,
      409,
    );
    const file = resolve(directory, "upload.tmp");
    await writeFile(file, "temporary");
    await assert.rejects(
      require("../dist/versions/versions.service").saveBuild(
        { path: file },
        {},
        "admin",
      ),
      (error) => error.status === 409,
    );
    await assert.rejects(readFile(file), { code: "ENOENT" });
  });
});
test("cleanup refuses a junction escaping the artifact storage and can retry an interrupted deletion", async () => {
  const id = new ObjectId(),
    target = resolve(directory, "outside");
  await mkdir(target);
  await writeFile(resolve(target, "keep.txt"), "keep");
  const folder = resolve(directory, "archives", id.toHexString());
  await symlink(target, folder, "junction");
  await db.versions.insertOne({
    _id: id,
    project: "cleanup",
    version: "junction",
    createdAt: old,
    status: "ready",
  });
  await due();
  await runRetention(now);
  assert.equal(await readFile(resolve(target, "keep.txt"), "utf8"), "keep");
  assert.equal((await db.versions.findOne({ _id: id })).status, "deleting");
  assert.match(
    (await db.retentionSettings.findOne({ _id: "retention" })).lastError,
    /junções|Links/,
  );
  // Remove only the test junction, with its resolved parent checked above.
  assert.equal(resolve(folder, ".."), resolve(directory, "archives"));
  await rm(folder, { recursive: true });
  await due();
  await runRetention(now);
  assert.equal(await db.versions.findOne({ _id: id }), null);
});
