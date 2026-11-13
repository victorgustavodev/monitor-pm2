const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
  symlink,
  stat,
  utimes,
} = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { resolve, sep } = require("node:path");
const { once } = require("node:events");
const { randomUUID } = require("node:crypto");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { zip } = require("./archive-fixture.cjs");
let directory,
  memory,
  server,
  origin,
  cookie,
  db,
  project,
  first,
  second,
  mainModule;
let failDeployment = false,
  holdDeployment,
  releaseDeployment;
const deployments = [];
const heldDeployments = new Map();
let managedProject,
  referencedPaths = [],
  pm2Unavailable = false;
let linkedRows = [],
  stoppedProcesses = [],
  stopFailure = false;

before(
  async () => {
    directory = await mkdtemp(resolve(tmpdir(), "monitor-projects-"));
    memory = await MongoMemoryServer.create();
    Object.assign(process.env, {
      MONGODB_URI: memory.getUri(),
      MONGODB_DATABASE: "project_tests",
      ADMIN_USERNAME: "admin",
      ADMIN_PASSWORD: "test-password-12345",
      JWT_SECRET: "project-test-secret-more-than-thirty-two-characters",
      VERSIONS_DIR: resolve(directory, "archives"),
      PM2_HOME: resolve(directory, "pm2"),
      UPLOAD_MAX_MB: "1",
      EXTRACTED_MAX_MB: "2",
      COOKIE_SECURE: "false",
    });
    const pm2 = require("../dist/pm2/pm2.service");
    const { selectProjectProcesses } = require("../dist/pm2/project-processes");
    const { HttpError } = require("../dist/common/http-error");
    pm2.getProjectProcesses = async (root) =>
      selectProjectProcesses(linkedRows, root);
    pm2.stopProjectProcesses = async (root, revision) => {
      const preview = selectProjectProcesses(linkedRows, root);
      if (revision !== preview.revision)
        throw new HttpError(409, "Os processos vinculados mudaram.");
      if (stopFailure) throw new HttpError(502, "Falha ao encerrar processo.");
      stoppedProcesses.push(...preview.processes.map((process) => process.id));
      for (const row of linkedRows)
        if (stoppedProcesses.includes(row.pm_id))
          row.pm2_env.status = "stopped";
    };
    pm2.processArtifactPaths = async () => {
      if (pm2Unavailable) throw new Error("PM2 indisponível");
      return referencedPaths;
    };
    pm2.deployEcosystem = async (path) => {
      await readFile(path);
      deployments.push(path);
      if (holdDeployment)
        await new Promise((done) => {
          releaseDeployment = done;
          heldDeployments.set(path, done);
        });
      heldDeployments.delete(path);
      if (failDeployment) throw new Error("Falha simulada no PM2.");
    };
    const main = require("../dist/main");
    mainModule = main;
    db = require("../dist/common/database");
    await main.initialize();
    server = main.app.listen(0, "127.0.0.1");
    await once(server, "listening");
    origin = `http://127.0.0.1:${server.address().port}`;
  },
  { timeout: 120000 },
);

after(async () => {
  releaseDeployment?.();
  for (const release of heldDeployments.values()) release();
  if (server) await new Promise((done) => server.close(done));
  await mainModule?.flushAudit();
  await db?.mongo.close();
  await memory?.stop();
  if (
    directory &&
    directory.startsWith(resolve(tmpdir()) + sep) &&
    directory.includes("monitor-projects-")
  ) {
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200,
    });
  }
});

function request(path, options = {}) {
  const headers = new Headers(options.headers);
  if (cookie) headers.set("cookie", cookie);
  if (typeof options.body === "string")
    headers.set("content-type", "application/json");
  return fetch(origin + path, { ...options, headers });
}
const post = (path, body) =>
  request(path, { method: "POST", body: JSON.stringify(body) });
async function json(response, status = 200) {
  const text = await response.text();
  assert.equal(response.status, status, text);
  return text ? JSON.parse(text) : undefined;
}
function upload(
  id,
  name,
  entries,
  comments = "Atualização da aplicação para esta versão.",
  operationId,
  background = false,
) {
  const data = new FormData();
  data.set("name", name);
  data.set("comments", comments);
  data.set("build", new Blob([zip(entries)]), "release.zip");
  const query = operationId ? `?operationId=${operationId}${background ? "&background=true" : ""}` : "";
  return request(`/api/projects/${id}/builds${query}`, { method: "POST", body: data });
}
const packageFiles = (version, wrapper = "") => [
  [
    `${wrapper}ecosystem.config.js`,
    'module.exports={apps:[{name:"project-test",script:"./dist/main.js"}]};',
  ],
  [`${wrapper}dist/main.js`, `console.log('${version}');`],
];

test("projects, file browsing and project build publication", async (t) => {
  await t.test(
    "requires login and registers a dedicated local project folder",
    async () => {
      assert.equal((await request("/api/projects")).status, 401);
      assert.equal((await request("/api/builds")).status, 401);
      const login = await post("/api/auth/login", {
        username: "admin",
        password: process.env.ADMIN_PASSWORD,
      });
      assert.equal(login.status, 200);
      cookie = login.headers.get("set-cookie").split(";")[0];
      project = await json(
        await post("/api/projects", {
          name: "Projeto X",
          description: "Aplicação principal",
          rootPath: resolve(directory, "apps/project-x"),
        }),
        201,
      );
      assert.equal(
        project.pathToRunPm2,
        resolve(project.rootPath, "ecosystem.config.js"),
      );
      assert.equal(project.createdBy, "admin");
      assert.equal(project.buildCount, 0);
      assert.equal((await json(await request("/api/projects"))).length, 1);
      assert.equal(
        (
          await post("/api/projects", {
            name: "projeto x",
            rootPath: resolve(directory, "apps/other"),
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await post("/api/projects", {
            name: "nested",
            rootPath: resolve(project.rootPath, "child"),
          })
        ).status,
        409,
      );
      for (const rootPath of [
        "relative/path",
        resolve(directory, "archives"),
        resolve(__dirname, "../../.."),
      ]) {
        assert.equal(
          (await post("/api/projects", { name: "invalid", rootPath })).status,
          400,
        );
      }
      assert.equal(
        (
          await post("/api/projects", {
            name: "invalid",
            rootPath: resolve(directory, "invalid"),
            pm2ConfigPath: "../ecosystem.config.js",
          })
        ).status,
        400,
      );
    },
  );

  await t.test(
    "browses files, previews text and downloads only inside the registered folder",
    async () => {
      await mkdir(resolve(project.rootPath, "docs"));
      await writeFile(
        resolve(project.rootPath, "docs/README.md"),
        "# Projeto X\nTexto <script>seguro</script>",
      );
      await writeFile(resolve(project.rootPath, ".env"), "LOCAL_CONFIG=keep");
      await writeFile(
        resolve(project.rootPath, "large.txt"),
        "x".repeat(300000),
      );
      await writeFile(
        resolve(project.rootPath, "binary.dat"),
        Buffer.from([0, 1, 2]),
      );
      const listing = await json(
        await request(`/api/projects/${project._id}/files`),
      );
      assert.equal(listing.type, "directory");
      assert.equal(listing.entries[0].name, "docs");
      const text = await json(
        await request(
          `/api/projects/${project._id}/files?path=docs%2FREADME.md`,
        ),
      );
      assert.match(text.content, /Projeto X/);
      assert.equal(text.binary, false);
      const large = await json(
        await request(`/api/projects/${project._id}/files?path=large.txt`),
      );
      assert.equal(large.truncated, true);
      assert.equal(large.content.length, 256 * 1024);
      assert.equal(
        (
          await json(
            await request(`/api/projects/${project._id}/files?path=binary.dat`),
          )
        ).binary,
        true,
      );
      const download = await request(
        `/api/projects/${project._id}/files/download?path=docs%2FREADME.md`,
      );
      assert.equal(download.status, 200);
      assert.match(await download.text(), /Projeto X/);
      for (const path of [
        "../outside.txt",
        "/absolute.txt",
        "C:/Windows/win.ini",
        "docs/../../outside.txt",
      ]) {
        assert.equal(
          (
            await request(
              `/api/projects/${project._id}/files?path=${encodeURIComponent(path)}`,
            )
          ).status,
          400,
        );
      }
      const outside = resolve(directory, "outside");
      await mkdir(outside);
      await writeFile(resolve(outside, "secret.txt"), "outside");
      await symlink(
        outside,
        resolve(project.rootPath, "external"),
        process.platform === "win32" ? "junction" : "dir",
      );
      assert.equal(
        (
          await request(
            `/api/projects/${project._id}/files?path=external%2Fsecret.txt`,
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await request(
            `/api/projects/${project._id}/files/download?path=external%2Fsecret.txt`,
          )
        ).status,
        400,
      );
    },
  );

  await t.test(
    "requires build comments, publishes the archive into the project root and records author",
    async () => {
      assert.equal(
        (await upload(project._id, "empty-comment", packageFiles("bad"), "   "))
          .status,
        400,
      );
      assert.equal(await db.projectBuilds.countDocuments(), 0);
      first = await json(
        await upload(project._id, "build-06-11-v1", [
          ...packageFiles("v1", "release/"),
          ["release/old.txt", "old"],
        ]),
        201,
      );
      assert.equal(first.status, "deployed");
      assert.equal(first.createdBy, "admin");
      assert.equal(first.number, 1);
      assert.equal(first.projectId, project._id);
      assert.ok(first.comments);
      assert.equal(
        deployments.at(-1),
        resolve(project.rootPath, "ecosystem.config.js"),
      );
      assert.match(
        await readFile(resolve(project.rootPath, "dist/main.js"), "utf8"),
        /v1/,
      );
      assert.equal(
        await readFile(resolve(project.rootPath, ".env"), "utf8"),
        "LOCAL_CONFIG=keep",
      );
      assert.equal(
        (await json(await request(`/api/projects/${project._id}`)))
          .activeBuildId,
        first._id,
      );
      assert.equal(
        (await upload(project._id, "BUILD-06-11-V1", packageFiles("duplicate")))
          .status,
        409,
      );
      const archive = await request(
        `/api/projects/${project._id}/builds/${first._id}/archive`,
      );
      assert.equal(archive.status, 200);
      assert.match(
        archive.headers.get("content-disposition"),
        /build-06-11-v1.zip/,
      );
      assert.equal(
        Buffer.from(await archive.arrayBuffer())
          .subarray(0, 2)
          .toString(),
        "PK",
      );
    },
  );

  await t.test(
    "publishes new versions, removes obsolete managed files, and republishes a prior build",
    async () => {
      second = await json(
        await upload(project._id, "build-06-11-v2", packageFiles("v2")),
        201,
      );
      assert.equal(second.number, 2);
      assert.match(
        await readFile(resolve(project.rootPath, "dist/main.js"), "utf8"),
        /v2/,
      );
      await assert.rejects(readFile(resolve(project.rootPath, "old.txt")), {
        code: "ENOENT",
      });
      assert.equal(
        await readFile(resolve(project.rootPath, ".env"), "utf8"),
        "LOCAL_CONFIG=keep",
      );
      const previous = await json(
        await post(
          `/api/projects/${project._id}/builds/${first._id}/deploy`,
          {},
        ),
      );
      assert.equal(previous.status, "deployed");
      assert.match(
        await readFile(resolve(project.rootPath, "dist/main.js"), "utf8"),
        /v1/,
      );
      assert.equal(
        await readFile(resolve(project.rootPath, "old.txt"), "utf8"),
        "old",
      );
      const history = await json(
        await request(`/api/projects/${project._id}/builds`),
      );
      assert.equal(history.total, 2);
      assert.equal(
        history.items.find((build) => build._id === first._id).active,
        true,
      );
      const other = await json(
        await post("/api/projects", {
          name: "Projeto Y",
          rootPath: resolve(directory, "apps/project-y"),
        }),
        201,
      );
      assert.equal(
        (
          await post(
            `/api/projects/${other._id}/builds/${first._id}/deploy`,
            {},
          )
        ).status,
        404,
      );
      assert.equal(
        (
          await request(
            `/api/projects/${other._id}/builds/${first._id}/archive`,
          )
        ).status,
        404,
      );
    },
  );

  await t.test(
    "restores original files after PM2 failure and keeps the failed build for a retry",
    async () => {
      failDeployment = true;
      const failedResponse = await upload(project._id, "failed-build", [
        ...packageFiles("broken"),
        ["new.txt", "new"],
      ]);
      assert.equal(failedResponse.status, 502);
      assert.match((await failedResponse.json()).message, /restaurados/);
      failDeployment = false;
      assert.match(
        await readFile(resolve(project.rootPath, "dist/main.js"), "utf8"),
        /v1/,
      );
      assert.equal(
        await readFile(resolve(project.rootPath, "old.txt"), "utf8"),
        "old",
      );
      await assert.rejects(readFile(resolve(project.rootPath, "new.txt")), {
        code: "ENOENT",
      });
      const state = await json(await request(`/api/projects/${project._id}`));
      assert.equal(state.activeBuildId, first._id);
      assert.equal(state.deploying, false);
      const history = await json(
        await request(`/api/projects/${project._id}/builds`),
      );
      const failed = history.items.find(
        (build) => build.name === "failed-build",
      );
      assert.equal(failed.status, "failed");
      assert.equal(failed.extracted, true);
      assert.equal(
        (
          await json(
            await post(
              `/api/projects/${project._id}/builds/${failed._id}/deploy`,
              {},
            ),
          )
        ).status,
        "deployed",
      );
    },
  );

  await t.test(
    "rejects invalid packages without changing the live project and rejects a missing PM2 configuration",
    async () => {
      assert.equal(
        (
          await upload(project._id, "unsafe-build", [
            ["../outside.txt", "invalid"],
          ])
        ).status,
        400,
      );
      assert.match(
        await readFile(resolve(project.rootPath, "dist/main.js"), "utf8"),
        /broken/,
      );
      const history = await json(
        await request(`/api/projects/${project._id}/builds`),
      );
      const failed = history.items.find(
        (build) => build.name === "unsafe-build",
      );
      assert.equal(failed.status, "failed");
      assert.equal(failed.extracted, false);
      assert.equal(
        (
          await post(
            `/api/projects/${project._id}/builds/${failed._id}/deploy`,
            {},
          )
        ).status,
        400,
      );
      const custom = await json(
        await post("/api/projects", {
          name: "Custom PM2",
          rootPath: resolve(directory, "apps/custom"),
          pm2ConfigPath: "config/ecosystem.config.js",
        }),
        201,
      );
      assert.equal(
        (await upload(custom._id, "missing-config", [["main.js", "code"]]))
          .status,
        400,
      );
      assert.deepEqual(await readdir(custom.rootPath), []);
      const build = await json(
        await upload(custom._id, "with-config", [
          ["wrapper/config/ecosystem.config.js", "module.exports={apps:[]};"],
          ["wrapper/main.js", "code"],
        ]),
        201,
      );
      assert.equal(build.status, "deployed");
      assert.equal(
        deployments.at(-1),
        resolve(custom.rootPath, "config/ecosystem.config.js"),
      );
    },
  );

  await t.test(
    "blocks simultaneous builds for the same project and cleans temporary uploads",
    async () => {
      holdDeployment = true;
      const pending = upload(
        project._id,
        "concurrent-one",
        packageFiles("concurrent"),
      );
      const deadline = Date.now() + 5000;
      while (!releaseDeployment) {
        assert.ok(Date.now() < deadline);
        await new Promise((done) => setTimeout(done, 10));
      }
      try {
        assert.equal(
          (
            await upload(
              project._id,
              "concurrent-two",
              packageFiles("conflict"),
            )
          ).status,
          409,
        );
      } finally {
        holdDeployment = false;
        releaseDeployment();
      }
      assert.equal((await pending).status, 201);
      assert.deepEqual(
        await readdir(resolve(directory, "archives/.uploads")),
        [],
      );
    },
  );

  await t.test(
    "restores the deployment journal after a server interruption",
    async () => {
      const { ObjectId } = require("mongodb");
      const { prepareDeployment } = require("../dist/projects/project-deploy");
      const { deploymentFolder } = require("../dist/projects/project-storage");
      const {
        recoverProjectBuilds,
      } = require("../dist/projects/project-builds.service");
      const projectObjectId = new ObjectId(project._id);
      const source = resolve(directory, "crash-source");
      await mkdir(source);
      await writeFile(resolve(source, "crash.txt"), "interrupted");
      const attemptId = randomUUID();
      const buildId = new ObjectId(second._id);
      const apply = await prepareDeployment(
        project.rootPath,
        source,
        ["crash.txt"],
        [],
        deploymentFolder(projectObjectId, buildId, attemptId),
      );
      await db.projects.updateOne(
        { _id: projectObjectId },
        { $set: { deployment: { buildId, attemptId } } },
      );
      await apply();
      assert.equal(
        await readFile(resolve(project.rootPath, "crash.txt"), "utf8"),
        "interrupted",
      );
      await recoverProjectBuilds();
      await assert.rejects(readFile(resolve(project.rootPath, "crash.txt")), {
        code: "ENOENT",
      });
      const state = await json(await request(`/api/projects/${project._id}`));
      assert.equal(state.deploying, false);
      assert.match(state.deploymentError, /interrompida/);
    },
  );

  await t.test(
    "lists builds across projects and paginates history",
    async () => {
      const { ObjectId } = require("mongodb");
      const original = await db.projectBuilds.findOne({
        _id: new ObjectId(first._id),
      });
      const { _id, ...copy } = original;
      await db.projectBuilds.insertMany(
        Array.from({ length: 23 }, (_, index) => ({
          ...copy,
          name: `page-${index}`,
          nameKey: `page-${index}`,
        })),
      );
      const one = await json(
        await request(`/api/builds?projectId=${project._id}&page=1`),
      );
      const two = await json(
        await request(`/api/builds?projectId=${project._id}&page=2`),
      );
      assert.equal(one.items.length, 20);
      assert.ok(two.items.length > 0);
      assert.ok(one.items.every((build) => build.projectName === "Projeto X"));
      assert.ok(
        !one.items.some((build) =>
          two.items.some((other) => other._id === build._id),
        ),
      );
      assert.equal((await request("/api/builds?page=0")).status, 400);
    },
  );
});

test("updates a project while preserving its history and validating names, folders and configuration", async () => {
  managedProject = await json(
    await post("/api/projects", {
      name: "Editable",
      rootPath: resolve(directory, "editable"),
    }),
    201,
  );
  const body = {
    name: "Editable renamed",
    description: "Nova descrição",
    rootPath: managedProject.rootPath,
    pm2ConfigPath: "ecosystem.config.js",
  };
  const path = `/api/projects/${managedProject._id}`;
  assert.equal(
    (
      await fetch(origin + path, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
    ).status,
    401,
  );
  const build = await json(
    await upload(managedProject._id, "edit-v1", packageFiles("v1")),
    201,
  );
  const updated = await json(
    await request(path, { method: "PUT", body: JSON.stringify(body) }),
  );
  assert.equal(updated._id, managedProject._id);
  assert.equal(updated.name, body.name);
  assert.equal(updated.description, body.description);
  assert.equal(updated.createdBy, managedProject.createdBy);
  assert.equal(updated.createdAt, managedProject.createdAt);
  assert.equal(updated.updatedBy, "admin");
  assert.equal(updated.buildCount, 1);
  assert.equal(updated.activeBuildId, build._id);
  assert.equal(updated.nextBuildNumber, 1);
  assert.equal(
    (await json(await request(`${path}/builds`))).items[0].projectName,
    body.name,
  );
  for (const [changes, status] of [
    [{ name: "Projeto X" }, 409],
    [{ rootPath: project.rootPath }, 409],
    [{ rootPath: resolve(project.rootPath, "nested") }, 409],
    [{ rootPath: "relative/path" }, 400],
    [{ rootPath: resolve(directory, "archives") }, 400],
    [{ pm2ConfigPath: "../ecosystem.config.js" }, 400],
    [{ description: "x".repeat(501) }, 400],
  ]) {
    assert.equal(
      (
        await request(path, {
          method: "PUT",
          body: JSON.stringify({ ...body, ...changes }),
        })
      ).status,
      status,
    );
  }
  managedProject = updated;
});

test("changing project destination preserves old files and resets only the active-build pointer", async () => {
  const previous = managedProject.rootPath;
  const body = {
    name: managedProject.name,
    description: managedProject.description,
    rootPath: resolve(directory, "editable-moved"),
    pm2ConfigPath: "config/ecosystem.config.js",
  };
  const updated = await json(
    await request(`/api/projects/${managedProject._id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  );
  assert.equal(updated.activeBuildId, undefined);
  assert.equal(updated.buildCount, 1);
  assert.equal(
    updated.pathToRunPm2,
    resolve(body.rootPath, body.pm2ConfigPath),
  );
  assert.match(await readFile(resolve(previous, "dist/main.js"), "utf8"), /v1/);
  assert.deepEqual(await readdir(updated.rootPath), []);
  managedProject = await json(
    await request(`/api/projects/${updated._id}`, {
      method: "PUT",
      body: JSON.stringify({ ...body, pm2ConfigPath: "ecosystem.config.js" }),
    }),
  );
});

test("project updates and deletion cannot overlap a publication or pending recovery", async () => {
  const path = `/api/projects/${managedProject._id}`;
  const body = {
    name: managedProject.name,
    rootPath: managedProject.rootPath,
    pm2ConfigPath: managedProject.pm2ConfigPath,
  };
  holdDeployment = true;
  releaseDeployment = undefined;
  const pending = upload(managedProject._id, "edit-v2", packageFiles("v2"));
  try {
    const deadline = Date.now() + 5000;
    while (!releaseDeployment && Date.now() < deadline)
      await new Promise((done) => setTimeout(done, 10));
    assert.ok(releaseDeployment);
    assert.equal(
      (await request(path, { method: "PUT", body: JSON.stringify(body) }))
        .status,
      409,
    );
    assert.equal((await request(path, { method: "DELETE" })).status, 409);
  } finally {
    holdDeployment = false;
    releaseDeployment?.();
  }
  await json(await pending, 201);
  const { ObjectId } = require("mongodb");
  const id = new ObjectId(managedProject._id);
  await db.projects.updateOne(
    { _id: id },
    {
      $set: {
        deployment: { buildId: new ObjectId(), attemptId: randomUUID() },
      },
    },
  );
  assert.equal(
    (await request(path, { method: "PUT", body: JSON.stringify(body) })).status,
    409,
  );
  assert.equal((await request(path, { method: "DELETE" })).status, 409);
  await db.projects.updateOne({ _id: id }, { $unset: { deployment: "" } });
});

test("deleting removes project records and archives while preserving the application and other projects", async () => {
  const path = `/api/projects/${managedProject._id}`;
  const folder = resolve(directory, "archives/projects", managedProject._id);
  assert.equal((await fetch(origin + path, { method: "DELETE" })).status, 401);
  referencedPaths = [resolve(folder, "source/app.js")];
  assert.equal((await request(path, { method: "DELETE" })).status, 409);
  referencedPaths = [];
  pm2Unavailable = true;
  assert.equal((await request(path, { method: "DELETE" })).status, 502);
  pm2Unavailable = false;
  const { ObjectId } = require("mongodb");
  const id = new ObjectId(managedProject._id);
  // Simulate a restart after deletion was marked, before artifacts were removed.
  await db.projects.updateOne({ _id: id }, { $set: { deleting: true } });
  assert.equal((await request(path + "/files")).status, 409);
  const history = await json(await request(`/api/builds?projectId=${id}`));
  assert.ok(history.items.length > 0);
  assert.equal(
    (
      await request(`${path}/builds/${history.items[0]._id}/deploy`, {
        method: "POST",
      })
    ).status,
    409,
  );
  assert.equal((await request(path, { method: "DELETE" })).status, 204);
  assert.equal((await request(path)).status, 404);
  await assert.rejects(readdir(folder), { code: "ENOENT" });
  assert.equal(await db.projectBuilds.countDocuments({ projectId: id }), 0);
  assert.match(
    await readFile(resolve(managedProject.rootPath, "dist/main.js"), "utf8"),
    /v2/,
  );
  assert.equal((await request(`/api/projects/${project._id}`)).status, 200);
  assert.equal((await request(path, { method: "DELETE" })).status, 404);
});

test("project deletion rejects storage junctions without touching their external target", async () => {
  const entry = await json(
    await post("/api/projects", {
      name: "Delete junction",
      rootPath: resolve(directory, "junction-app"),
    }),
    201,
  );
  const outside = resolve(directory, "junction-target");
  await mkdir(outside);
  await writeFile(resolve(outside, "keep.txt"), "keep");
  const folder = resolve(directory, "archives/projects", entry._id);
  await symlink(outside, folder, "junction");
  assert.equal(
    (await request(`/api/projects/${entry._id}`, { method: "DELETE" })).status,
    400,
  );
  assert.equal(await readFile(resolve(outside, "keep.txt"), "utf8"), "keep");
  assert.equal((await request(`/api/projects/${entry._id}`)).status, 200);
});

test("saved PM2 configuration is validated without executing it and is preserved by older clients", async () => {
  const marker = resolve(directory, "must-not-execute.txt");
  const content = `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed');\nmodule.exports = { apps: [] };`;
  const body = {
    name: "Configuration validation",
    rootPath: resolve(directory, "configuration-validation"),
    pm2ConfigContent: content,
  };
  const entry = await json(await post("/api/projects", body), 201);
  assert.equal(entry.pm2ConfigContent, content);
  await assert.rejects(readFile(marker), { code: "ENOENT" });
  const path = `/api/projects/${entry._id}`;
  for (const invalid of ["module.exports = {", 42, "é".repeat(9000)]) {
    assert.equal(
      (
        await request(path, {
          method: "PUT",
          body: JSON.stringify({ ...body, pm2ConfigContent: invalid }),
        })
      ).status,
      400,
    );
  }
  const { pm2ConfigContent, ...legacyBody } = body;
  const kept = await json(
    await request(path, { method: "PUT", body: JSON.stringify(legacyBody) }),
  );
  assert.equal(kept.pm2ConfigContent, content);
  const cleared = await json(
    await request(path, {
      method: "PUT",
      body: JSON.stringify({ ...legacyBody, pm2ConfigContent: "" }),
    }),
  );
  assert.equal(cleared.pm2ConfigContent, "");
});

test("local ecosystem edits and timestamps survive new builds and old snapshot republication", async () => {
  const configA =
    'module.exports={apps:[{name:"saved-app",script:"./dist/main.js",env:{RELEASE:"a"}}]};';
  const configB = configA.replace('"a"', '"b"');
  const configC = configA.replace('"a"', '"zip"');
  const body = {
    name: "Saved configuration",
    rootPath: resolve(directory, "saved-configuration"),
    pm2ConfigContent: configA,
  };
  const entry = await json(await post("/api/projects", body), 201);
  const path = `/api/projects/${entry._id}`;
  const firstFiles = [["dist/main.js", 'console.log("release-a")']];
  const firstBuild = await json(
    await upload(entry._id, "without-ecosystem-v1", firstFiles),
    201,
  );
  const liveConfig = resolve(entry.rootPath, "ecosystem.config.js");
  assert.equal(await readFile(liveConfig, "utf8"), configA);
  assert.equal(deployments.at(-1), liveConfig);
  const archivedConfig = resolve(
    directory,
    "archives/projects",
    entry._id,
    firstBuild._id,
    "source/ecosystem.config.js",
  );
  assert.equal(await readFile(archivedConfig, "utf8"), configA);
  assert.deepEqual(
    Buffer.from(
      await (
        await request(`${path}/builds/${firstBuild._id}/archive`)
      ).arrayBuffer(),
    ),
    zip(firstFiles),
  );
  await json(
    await request(path, {
      method: "PUT",
      body: JSON.stringify({ ...body, pm2ConfigContent: configB }),
    }),
  );
  assert.equal(
    await readFile(liveConfig, "utf8"),
    configA,
    "Saving settings does not change live files",
  );
  const localConfig = configA.replace('"a"', '"local-edit"');
  await writeFile(liveConfig, localConfig);
  await utimes(liveConfig, new Date("2026-01-01T11:02:00Z"), new Date("2026-01-01T11:02:00Z"));
  const modified = (await stat(liveConfig)).mtimeMs;
  await json(
    await upload(entry._id, "without-ecosystem-v2", [
      ["dist/main.js", 'console.log("release-b")'],
    ]),
    201,
  );
  assert.equal(await readFile(liveConfig, "utf8"), localConfig);
  assert.equal((await stat(liveConfig)).mtimeMs, modified);
  await json(await post(`${path}/builds/${firstBuild._id}/deploy`, {}));
  assert.equal(await readFile(liveConfig, "utf8"), localConfig);
  assert.equal((await stat(liveConfig)).mtimeMs, modified);
  await json(
    await upload(entry._id, "ecosystem-from-zip", [
      ["ecosystem.config.js", configC],
      ["dist/main.js", 'console.log("zip")'],
    ]),
    201,
  );
  assert.equal(
    await readFile(liveConfig, "utf8"),
    localConfig,
    "The local configuration takes precedence over the archive",
  );
  assert.equal((await stat(liveConfig)).mtimeMs, modified);
  await json(
    await request(path, {
      method: "PUT",
      body: JSON.stringify({ ...body, pm2ConfigContent: "" }),
    }),
  );
  await json(
    await upload(entry._id, "use-existing-vm-config", [
      ["dist/main.js", 'console.log("vm")'],
    ]),
    201,
  );
  assert.equal(
    await readFile(liveConfig, "utf8"),
    localConfig,
    "An existing VM configuration is preserved",
  );
  assert.equal((await stat(liveConfig)).mtimeMs, modified);
  // When the local file is absent, an archived snapshot can still initialize it.
  await rm(liveConfig);
  await json(await post(`${path}/builds/${firstBuild._id}/deploy`, {}));
  assert.equal(await readFile(liveConfig, "utf8"), configA);
});

test("saved configuration initializes a missing ecosystem and failed deployments preserve local files", async () => {
  const body = {
    name: "Retry saved configuration",
    rootPath: resolve(directory, "retry-configuration"),
  };
  const entry = await json(await post("/api/projects", body), 201);
  const path = `/api/projects/${entry._id}`;
  const missing = await upload(entry._id, "missing-ecosystem", [
    ["dist/main.js", 'console.log("original")'],
  ]);
  assert.equal(missing.status, 400);
  assert.match((await missing.json()).message, /Variáveis de ambiente/);
  const failed = (await json(await request(`${path}/builds`))).items[0];
  const configA =
    'module.exports={apps:[{name:"retry-app",script:"./dist/main.js"}]};';
  await json(
    await request(path, {
      method: "PUT",
      body: JSON.stringify({ ...body, pm2ConfigContent: configA }),
    }),
  );
  await json(await post(`${path}/builds/${failed._id}/deploy`, {}));
  assert.equal(
    await readFile(resolve(entry.rootPath, "ecosystem.config.js"), "utf8"),
    configA,
  );
  const configPath = resolve(entry.rootPath, "ecosystem.config.js");
  const modified = (await stat(configPath)).mtimeMs;
  await json(
    await request(path, {
      method: "PUT",
      body: JSON.stringify({
        ...body,
        pm2ConfigContent: configA + "\n// new configuration",
      }),
    }),
  );
  failDeployment = true;
  try {
    assert.equal(
      (
        await upload(entry._id, "failed-pm2-config", [
          ["dist/main.js", 'console.log("changed")'],
        ])
      ).status,
      502,
    );
  } finally {
    failDeployment = false;
  }
  assert.equal(
    await readFile(resolve(entry.rootPath, "ecosystem.config.js"), "utf8"),
    configA,
  );
  assert.match(
    await readFile(resolve(entry.rootPath, "dist/main.js"), "utf8"),
    /original/,
  );
  assert.equal((await stat(configPath)).mtimeMs, modified);
  // A failed first installation must remove the newly created config on rollback.
  await rm(configPath);
  failDeployment = true;
  try {
    assert.equal((await upload(entry._id, "failed-initial-config", [["dist/main.js", "new"]])).status, 502);
  } finally { failDeployment = false; }
  await assert.rejects(readFile(configPath), { code: "ENOENT" });
});

test("documentation persists separately, preserves legacy updates and validates size and type", async () => {
  const body = { name: "Documented project", rootPath: resolve(directory, "documented-project") };
  const documentation = "# README\n<script>plain text</script>\n```sql\nCREATE TABLE example (id INT);\n```";
  const entry = await json(await post("/api/projects", { ...body, documentation }), 201);
  const path = `/api/projects/${entry._id}`;
  assert.equal(entry.documentation, documentation);
  await json(await request(path, { method: "PUT", body: JSON.stringify(body) }));
  assert.equal((await json(await request(path))).documentation, documentation);
  for (const invalid of [null, {}, "é".repeat(17000)]) {
    assert.equal((await request(path, { method: "PUT", body: JSON.stringify({ ...body, documentation: invalid }) })).status, 400);
  }
  assert.equal((await json(await request(path))).documentation, documentation);
  const changed = await json(await request(path, { method: "PUT", body: JSON.stringify({ ...body, documentation: "# Updated" }) }));
  assert.equal(changed.documentation, "# Updated");
  const cleared = await json(await request(path, { method: "PUT", body: JSON.stringify({ ...body, documentation: "" }) }));
  assert.equal(cleared.documentation, "");
  await assert.rejects(readFile(resolve(entry.rootPath, "README.md")), { code: "ENOENT" });
});

test("environment files support authenticated editing, detect conflicts and reject unsafe paths and concurrent deployments", async () => {
  const entry = await json(await post("/api/projects", { name: "Environment files", rootPath: resolve(directory, "environment-files") }), 201);
  const base = `/api/projects/${entry._id}/environment-files/`;
  assert.equal((await fetch(origin + base + ".env")).status, 401);
  const missing = await json(await request(base + ".env"));
  assert.equal(missing.revision, null);
  assert.equal(missing.content, "");
  const content = '# comentário\r\nPORT=3000\r\nVALUE="a=b # literal"\r\n';
  const saved = await json(await request(base + ".env", { method: "PUT", body: JSON.stringify({ content, revision: null }) }));
  assert.equal(await readFile(resolve(entry.rootPath, ".env"), "utf8"), content);
  const opened = await json(await request(base + ".env"));
  assert.equal(opened.revision, saved.revision);
  assert.deepEqual(opened.names, [".env"]);
  // Concurrent creation and external edits must not be overwritten.
  assert.equal((await request(base + ".env", { method: "PUT", body: JSON.stringify({ content: "PORT=4000", revision: null }) })).status, 409);
  await writeFile(resolve(entry.rootPath, ".env"), "PORT=5000\n");
  assert.equal((await request(base + ".env", { method: "PUT", body: JSON.stringify({ content: "PORT=4000", revision: saved.revision }) })).status, 409);
  assert.equal(await readFile(resolve(entry.rootPath, ".env"), "utf8"), "PORT=5000\n");
  const fresh = await json(await request(base + ".env"));
  await json(await request(base + ".env", { method: "PUT", body: JSON.stringify({ content: "PORT=6000\n", revision: fresh.revision }) }));
  await json(await request(base + ".env.production", { method: "PUT", body: JSON.stringify({ content: "MODE=production\n", revision: null }) }));
  assert.equal(await readFile(resolve(entry.rootPath, ".env.production"), "utf8"), "MODE=production\n");
  for (const name of ["README.md", "../.env", "config/.env", ".env/other"]) {
    assert.equal((await request(base + encodeURIComponent(name))).status, 400);
    assert.equal((await request(base + encodeURIComponent(name), { method: "PUT", body: JSON.stringify({ content: "bad", revision: null }) })).status, 400);
  }
  for (const content of [null, "x".repeat(33000), "KEY=\0value"]) {
    assert.equal((await request(base + ".env.invalid", { method: "PUT", body: JSON.stringify({ content, revision: null }) })).status, 400);
  }
  assert.equal((await request(base + ".env.invalid", { method: "PUT", body: JSON.stringify({ content: "KEY=1" }) })).status, 400);
  await mkdir(resolve(entry.rootPath, ".env.directory"));
  assert.equal((await request(base + ".env.directory")).status, 400);
  await writeFile(resolve(entry.rootPath, ".env.encoding"), Buffer.from([0xff]));
  assert.equal((await request(base + ".env.encoding")).status, 400);
  const outside = resolve(directory, "environment-outside");
  await mkdir(outside);
  await symlink(outside, resolve(entry.rootPath, ".env.link"), process.platform === "win32" ? "junction" : "dir");
  assert.equal((await request(base + ".env.link")).status, 400);
  assert.equal((await request(base + ".env.link", { method: "PUT", body: JSON.stringify({ content: "bad", revision: null }) })).status, 400);
  const { withProjectOperation } = require("../dist/projects/project-operations");
  const { ObjectId } = require("mongodb");
  await withProjectOperation(new ObjectId(entry._id), async () => {
    assert.equal((await request(base + ".env.busy", { method: "PUT", body: JSON.stringify({ content: "KEY=1", revision: null }) })).status, 409);
  });
  const before = deployments.length;
  await json(await request(base + ".env.empty", { method: "PUT", body: JSON.stringify({ content: "", revision: null }) }));
  assert.equal(deployments.length, before, "Saving env files does not execute PM2");
  const ecosystem = "module.exports={apps:[{name:'KWMS BLUE',script:'./main.js'}]};\n";
  const configUrl = base + "ecosystem.config.js";
  const created = await json(await request(configUrl, { method: "PUT", body: JSON.stringify({ content: ecosystem, revision: null }) }));
  assert.equal(await readFile(resolve(entry.rootPath, "ecosystem.config.js"), "utf8"), ecosystem);
  assert.equal((await json(await request(configUrl))).revision, created.revision);
  for (const invalid of ["module.exports = {", "x".repeat(16385)])
    assert.equal((await request(configUrl, { method: "PUT", body: JSON.stringify({ content: invalid, revision: created.revision }) })).status, 400);
  assert.equal((await request(configUrl, { method: "PUT", body: JSON.stringify({ content: ecosystem, revision: null }) })).status, 409);
  await withProjectOperation(new ObjectId(entry._id), async () => {
    assert.equal((await request(configUrl, { method: "PUT", body: JSON.stringify({ content: ecosystem, revision: created.revision }) })).status, 409);
  });
  assert.equal(deployments.length, before, "Editing the ecosystem must not execute PM2");
});

test("deletion previews identify processes by folder and keeping them leaves PM2 untouched", async () => {
  const entry = await json(
    await post("/api/projects", {
      name: "Keep linked processes",
      rootPath: resolve(directory, "keep-processes"),
    }),
    201,
  );
  const path = `/api/projects/${entry._id}`;
  linkedRows = [
    {
      pm_id: 11,
      name: "same-name",
      pm2_env: {
        status: "online",
        pm_cwd: entry.rootPath,
        pm_exec_path: resolve(entry.rootPath, "main.js"),
      },
    },
    {
      pm_id: 12,
      name: "worker",
      pm2_env: {
        status: "online",
        pm_cwd: directory,
        pm_exec_path: resolve(entry.rootPath, "worker.js"),
      },
    },
    {
      pm_id: 13,
      name: "same-name",
      pm2_env: {
        status: "online",
        pm_cwd: entry.rootPath + "-other",
        pm_exec_path: resolve(entry.rootPath + "-other", "main.js"),
      },
    },
  ];
  assert.equal((await fetch(origin + path + "/deletion-preview")).status, 401);
  const preview = await json(await request(path + "/deletion-preview"));
  assert.deepEqual(
    preview.processes.map((process) => process.id),
    [11, 12],
  );
  assert.equal(
    preview.processes.some(
      (process) => "cwd" in process || "script" in process,
    ),
    false,
  );
  assert.equal(stoppedProcesses.length, 0);
  await json(
    await request(path, {
      method: "DELETE",
      body: JSON.stringify({
        stopProcesses: false,
        processRevision: preview.revision,
      }),
    }),
    204,
  );
  assert.equal(stoppedProcesses.length, 0);
  assert.equal(linkedRows[0].pm2_env.status, "online");
});

test("optional process termination requires the confirmed revision and keeps the project on stop failure", async () => {
  const entry = await json(
    await post("/api/projects", {
      name: "Stop linked processes",
      rootPath: resolve(directory, "stop-processes"),
    }),
    201,
  );
  await writeFile(resolve(entry.rootPath, "keep.txt"), "application files");
  const path = `/api/projects/${entry._id}`;
  linkedRows = [
    {
      pm_id: 21,
      name: "project-app",
      pm2_env: {
        status: "online",
        pm_cwd: entry.rootPath,
        pm_exec_path: resolve(entry.rootPath, "main.js"),
      },
    },
    {
      pm_id: 22,
      name: "project-app",
      pm2_env: {
        status: "online",
        pm_cwd: directory,
        pm_exec_path: resolve(directory, "unrelated.js"),
      },
    },
  ];
  const preview = await json(await request(path + "/deletion-preview"));
  assert.equal(
    (
      await request(path, {
        method: "DELETE",
        body: JSON.stringify({ stopProcesses: "true" }),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(path, {
        method: "DELETE",
        body: JSON.stringify({ stopProcesses: true }),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(path, {
        method: "DELETE",
        body: JSON.stringify({
          stopProcesses: true,
          processRevision: "outdated",
        }),
      })
    ).status,
    409,
  );
  linkedRows[0].pm2_env.pm_exec_path = resolve(entry.rootPath, "new-main.js");
  assert.equal(
    (
      await request(path, {
        method: "DELETE",
        body: JSON.stringify({
          stopProcesses: true,
          processRevision: preview.revision,
        }),
      })
    ).status,
    409,
  );
  assert.equal(stoppedProcesses.length, 0);
  const current = await json(await request(path + "/deletion-preview"));
  stopFailure = true;
  try {
    assert.equal(
      (
        await request(path, {
          method: "DELETE",
          body: JSON.stringify({
            stopProcesses: true,
            processRevision: current.revision,
          }),
        })
      ).status,
      502,
    );
  } finally {
    stopFailure = false;
  }
  assert.equal((await request(path)).status, 200);
  assert.equal((await json(await request(path))).deleting, undefined);
  await json(
    await request(path, {
      method: "DELETE",
      body: JSON.stringify({
        stopProcesses: true,
        processRevision: current.revision,
      }),
    }),
    204,
  );
  assert.deepEqual(stoppedProcesses, [21]);
  assert.equal(linkedRows[0].pm2_env.status, "stopped");
  assert.equal(linkedRows[1].pm2_env.status, "online");
  assert.equal(
    await readFile(resolve(entry.rootPath, "keep.txt"), "utf8"),
    "application files",
  );
});

test("publication endpoints stream stages, cancel file changes and preserve failure diagnostics", async () => {
  if (!cookie) {
    const login = await post("/api/auth/login", { username: "admin", password: process.env.ADMIN_PASSWORD });
    cookie = login.headers.get("set-cookie").split(";")[0];
  }
  const item = await json(await post("/api/projects", { name: "Progress test", rootPath: resolve(directory, "apps/progress") }), 201);
  const { getBuildOperation, cancelBuildOperation } = require("../dist/projects/build-progress");
  const start = async () => json(await post(`/api/projects/${item._id}/build-operations`), 201);
  const send = (operation, name) => {
    const form = new FormData();
    form.set("name", name); form.set("comments", "Progress test");
    form.set("build", new Blob([zip(packageFiles(name))]), "release.zip");
    return request(`/api/projects/${item._id}/builds?operationId=${operation.id}`, { method: "POST", body: form });
  };
  const cancelled = await start();
  const op = getBuildOperation(cancelled.id, item._id, "admin");
  op.events.on("progress", () => {
    if (op.state.percent > 60 && op.state.cancellable) cancelBuildOperation(op);
  });
  const cancelledResult = await json(await send(cancelled, "cancelled"), 409);
  assert.match(cancelledResult.message, /cancelada.*restaurados/);
  assert.equal(op.state.status, "cancelled");
  await assert.rejects(readFile(resolve(item.rootPath, "ecosystem.config.js")), { code: "ENOENT" });
  await assert.rejects(readFile(resolve(item.rootPath, "dist/main.js")), { code: "ENOENT" });

  const success = await start();
  const stream = await request(`/api/projects/${item._id}/build-operations/${success.id}/stream`, { headers: { "accept-encoding": "gzip" } });
  assert.equal(stream.headers.get("content-encoding"), null);
  const reader = stream.body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /event: progress/);
  await reader.cancel();
  const published = await json(await send(success, "success"), 201);
  assert.equal(getBuildOperation(success.id, item._id, "admin").state.percent, 100);
  assert.equal(published.status, "deployed");

  const failure = await start();
  failDeployment = true;
  try {
    await json(await post(`/api/projects/${item._id}/builds/${published._id}/deploy?operationId=${failure.id}`), 502);
    const state = getBuildOperation(failure.id, item._id, "admin").state;
    assert.equal(state.status, "failed");
    assert.match(state.logs.join("\n"), /Falha simulada no PM2.*restaurados/);
  } finally { failDeployment = false; }
});

test("missing active manifests allow publication without guessing which old files to delete", async (t) => {
  for (const missing of ["manifest", "directory"]) {
    await t.test(missing, async () => {
      const entry = await json(await post("/api/projects", {
        name: `Missing ${missing}`,
        rootPath: resolve(directory, `missing-${missing}`),
      }), 201);
      const first = await json(await upload(entry._id, "original", [
        ...packageFiles("original"), ["old.txt", "old"], [".env", "PORT=3000"],
      ]), 201);
      const liveConfig = resolve(entry.rootPath, "ecosystem.config.js");
      await writeFile(liveConfig, 'module.exports={apps:[{name:"local",script:"./dist/main.js"}]};');
      const config = await readFile(liveConfig, "utf8");
      const modified = (await stat(liveConfig)).mtimeMs;
      await writeFile(resolve(entry.rootPath, ".env"), "PORT=9000");
      await writeFile(resolve(entry.rootPath, "local.txt"), "local");
      const folder = resolve(directory, "archives/projects", entry._id, first._id);
      assert.ok(folder.startsWith(resolve(directory, "archives/projects") + sep));
      if (missing === "directory") await rm(folder, { recursive: true });
      else await rm(resolve(folder, "manifest.json"));
      const operation = await json(await post(`/api/projects/${entry._id}/build-operations`, {}), 201);
      const next = await json(await upload(entry._id, "next", [
        ...packageFiles("next"), ["next-only.txt", "next"],
      ], undefined, operation.id), 201);
      assert.match(await readFile(resolve(entry.rootPath, "dist/main.js"), "utf8"), /next/);
      assert.equal(await readFile(resolve(entry.rootPath, "old.txt"), "utf8"), "old");
      assert.equal(await readFile(resolve(entry.rootPath, "local.txt"), "utf8"), "local");
      assert.equal(await readFile(resolve(entry.rootPath, ".env"), "utf8"), "PORT=9000");
      assert.equal(await readFile(liveConfig, "utf8"), config);
      assert.equal((await stat(liveConfig)).mtimeMs, modified);
      const { getBuildOperation } = require("../dist/projects/build-progress");
      const progress = getBuildOperation(operation.id, entry._id, "admin").state;
      assert.equal(progress.status, "succeeded");
      assert.match(progress.logs.join("\n"), /Manifesto do build ativo ausente/);
      const manifest = JSON.parse(await readFile(resolve(directory, "archives/projects", entry._id, next._id, "manifest.json"), "utf8"));
      assert.deepEqual(manifest.sort(), ["dist/main.js", "next-only.txt"]);
      assert.equal((await json(await request(`/api/projects/${entry._id}`))).activeBuildId, next._id);
      await json(await upload(entry._id, "third", packageFiles("third")), 201);
      await assert.rejects(readFile(resolve(entry.rootPath, "next-only.txt")), { code: "ENOENT" });
      assert.equal(await readFile(resolve(entry.rootPath, "old.txt"), "utf8"), "old");
    });
  }
});

test("a failed publication with a missing active manifest restores overwritten files and can be retried", async () => {
  const entry = await json(await post("/api/projects", {
    name: "Missing manifest rollback", rootPath: resolve(directory, "missing-manifest-rollback"),
  }), 201);
  const original = await json(await upload(entry._id, "original", [
    ...packageFiles("original"), ["old.txt", "old"],
  ]), 201);
  await rm(resolve(directory, "archives/projects", entry._id, original._id, "manifest.json"));
  const configPath = resolve(entry.rootPath, "ecosystem.config.js");
  const modified = (await stat(configPath)).mtimeMs;
  failDeployment = true;
  try {
    const response = await upload(entry._id, "failed", [
      ...packageFiles("changed"), ["new.txt", "new"],
    ]);
    assert.match((await json(response, 502)).message, /restaurados/);
  } finally { failDeployment = false; }
  assert.match(await readFile(resolve(entry.rootPath, "dist/main.js"), "utf8"), /original/);
  assert.equal(await readFile(resolve(entry.rootPath, "old.txt"), "utf8"), "old");
  assert.equal((await stat(configPath)).mtimeMs, modified);
  await assert.rejects(readFile(resolve(entry.rootPath, "new.txt")), { code: "ENOENT" });
  const state = await json(await request(`/api/projects/${entry._id}`));
  assert.equal(state.activeBuildId, original._id);
  assert.equal(state.deploying, false);
  const history = await json(await request(`/api/projects/${entry._id}/builds`));
  const failed = history.items.find(build => build.name === "failed");
  await json(await post(`/api/projects/${entry._id}/builds/${failed._id}/deploy`, {}));
  assert.match(await readFile(resolve(entry.rootPath, "dist/main.js"), "utf8"), /changed/);
});

test("invalid or unreadable active manifests block publication before changing live files", async () => {
  const entry = await json(await post("/api/projects", {
    name: "Invalid manifest", rootPath: resolve(directory, "invalid-manifest"),
  }), 201);
  const original = await json(await upload(entry._id, "original", packageFiles("original")), 201);
  const manifest = resolve(directory, "archives/projects", entry._id, original._id, "manifest.json");
  const calls = deployments.length;
  const invalid = ["{", '{"files":[]}', '["../outside.txt"]', "[1]"];
  for (let index = 0; index < invalid.length; index++) {
    await writeFile(manifest, invalid[index]);
    const response = await upload(entry._id, `invalid-${index}`, packageFiles("changed"));
    assert.match((await json(response, 409)).message, /manifesto.*inválido/);
  }
  await rm(manifest);
  await mkdir(manifest);
  const unreadable = await upload(entry._id, "unreadable", packageFiles("changed"));
  assert.match((await json(unreadable, 409)).message, /Não foi possível ler o manifesto/);
  assert.equal(deployments.length, calls);
  assert.match(await readFile(resolve(entry.rootPath, "dist/main.js"), "utf8"), /original/);
  const state = await json(await request(`/api/projects/${entry._id}`));
  assert.equal(state.activeBuildId, original._id);
  assert.equal(state.deploying, false);
});

test("background builds reserve each project across users, return 202 and permit other projects concurrently", { timeout: 15000 }, async () => {
  const { createSession } = require("../dist/auth/auth.service");
  const { getBuildOperation } = require("../dist/projects/build-progress");
  await db.users.insertOne({ username: "background-operator", role: "user", passwordHash: "unused", createdAt: new Date() });
  const otherCookie = `pm2_session=${createSession("background-operator")}`;
  const other = (path, options = {}) => fetch(origin + path, { ...options, headers: { cookie: otherCookie, "content-type": "application/json" } });
  const entries = [];
  holdDeployment = true;
  try {
    for (const label of ["one", "two"]) {
      const entry = await json(await post("/api/projects", { name: `Background ${label}`, rootPath: resolve(directory, `background-${label}`) }), 201);
      const operation = await json(await post(`/api/projects/${entry._id}/build-operations`, {}), 201);
      entries.push({ entry, operation });
      assert.equal((await other(`/api/projects/${entry._id}/build-operations`, { method: "POST", body: "{}" })).status, 409);
      const state = await json(await request(`/api/projects/${entry._id}`));
      assert.equal(state.deploying, true, "Reserve from upload creation, before file replacement starts");
      await json(await upload(entry._id, "background", packageFiles(label), undefined, operation.id, true), 202);
    }
    for (let attempt = 0; attempt < 150 && heldDeployments.size < 2; attempt++) await new Promise(done => setTimeout(done, 25));
    assert.equal(heldDeployments.size, 2, "Both independent publications reach PM2 before either is released");
    const jobs = await json(await other("/api/build-operations"));
    for (const { entry, operation } of entries) {
      const job = jobs.find(job => job.id === operation.id);
      assert.equal(job.status, "running"); assert.equal(job.projectId, entry._id);
      assert.equal(job.canCancel, false);
      assert.equal((await other(`/api/projects/${entry._id}/build-operations/${operation.id}/cancel`, { method: "POST" })).status, 404);
      assert.equal((await upload(entry._id, "conflicting", packageFiles("conflict"))).status, 409);
      assert.equal((await other(`/api/projects/${entry._id}/environment-files/.env`, { method: "PUT", body: JSON.stringify({ content: "PORT=3000", revision: null }) })).status, 409);
    }
    for (const action of ["start", "restart", "stop", "delete"])
      assert.equal((await other(`/api/processes/1/${action}`, { method: "POST" })).status, 409);
    assert.equal((await other("/api/ecosystems", { method: "POST", body: JSON.stringify({ path: "unused" }) })).status, 409);
    assert.equal((await other("/api/processes/1/label", { method: "PUT", body: JSON.stringify({ label: "blocked" }) })).status, 409);
    assert.equal((await fetch(origin + "/api/build-operations")).status, 401);
    const large = getBuildOperation(entries[0].operation.id, entries[0].entry._id, "admin");
    large.state.logs.push("x".repeat(100000));
    const stream = await other("/api/build-operations/stream");
    const reader = stream.body.getReader();
    let frame = "";
    while (!frame.endsWith("\n\n")) {
      const chunk = await reader.read();
      assert.equal(chunk.done, false, "A large initial snapshot must not destroy the stream");
      frame += new TextDecoder().decode(chunk.value);
    }
    assert.match(frame, /event: publications/);
    assert.ok(frame.includes("x".repeat(100000)));
    await reader.cancel();
    large.state.logs.pop();
  } finally {
    holdDeployment = false;
    for (const release of heldDeployments.values()) release();
    for (let attempt = 0; attempt < 150 && entries.some(({ entry, operation }) => getBuildOperation(operation.id, entry._id, "admin").state.status === "running"); attempt++)
      await new Promise(done => setTimeout(done, 25));
  }
  for (const { entry, operation } of entries) {
    assert.equal(getBuildOperation(operation.id, entry._id, "admin").state.status, "succeeded");
    assert.equal((await json(await request(`/api/projects/${entry._id}`))).deploying, false);
  }
  const failure = await json(await post("/api/projects", { name: "Background failure", rootPath: resolve(directory, "background-failure") }), 201);
  const job = await json(await post(`/api/projects/${failure._id}/build-operations`, {}), 201);
  await json(await upload(failure._id, "missing-config", [["main.js", "app"]], undefined, job.id, true), 202);
  const failed = getBuildOperation(job.id, failure._id, "admin");
  for (let attempt = 0; attempt < 150 && failed.state.status === "running"; attempt++) await new Promise(done => setTimeout(done, 25));
  assert.equal(failed.state.status, "failed");
  assert.match(failed.state.logs.join("\n"), /Configuração PM2 não encontrada/);
  assert.equal((await json(await request(`/api/projects/${failure._id}`))).deploying, false);
  const retry = await json(await post(`/api/projects/${failure._id}/build-operations`, {}), 201);
  await json(await post(`/api/projects/${failure._id}/build-operations/${retry.id}/cancel`, {}));
});

test("roles can be edited only by admins and changes affect active sessions without exposing password hashes", async () => {
  const { createSession } = require("../dist/auth/auth.service");
  const admin = await db.users.findOne({ username: "admin" });
  const account = await json(await post("/api/users", { username: "role-edit-target", password: "test-password-12345" }), 201);
  const path = `/api/users/${account.id}/role`;
  const cookieForUser = `pm2_session=${createSession(account.username)}`;
  const userRequest = (target, options = {}) => fetch(origin + target, { ...options, headers: { cookie: cookieForUser, "content-type": "application/json" } });
  assert.equal((await fetch(origin + path, { method: "PUT" })).status, 401);
  assert.equal((await userRequest(path, { method: "PUT", body: JSON.stringify({ role: "admin" }) })).status, 403);
  const change = (target, role) => request(target, { method: "PUT", body: JSON.stringify({ role }) });
  assert.equal((await change(`/api/users/${admin._id}/role`, "user")).status, 409, "Keep the last administrator");
  assert.equal((await change(path, "owner")).status, 400);
  const promoted = await json(await change(path, "admin"));
  assert.equal(promoted.role, "admin"); assert.equal("passwordHash" in promoted, false);
  assert.equal((await userRequest("/api/users")).status, 200);
  assert.equal((await json(await userRequest("/api/auth/me"))).role, "admin");
  await json(await change(path, "user"));
  assert.equal((await userRequest("/api/users")).status, 403);
  assert.equal((await json(await userRequest("/api/auth/me"))).role, "user");
});
