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
    pm2.deployEcosystem = async (path) => {
      await readFile(path);
      deployments.push(path);
      if (holdDeployment)
        await new Promise((done) => {
          releaseDeployment = done;
        });
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
) {
  const data = new FormData();
  data.set("name", name);
  data.set("comments", comments);
  data.set("build", new Blob([zip(entries)]), "release.zip");
  return request(`/api/projects/${id}/builds`, { method: "POST", body: data });
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
