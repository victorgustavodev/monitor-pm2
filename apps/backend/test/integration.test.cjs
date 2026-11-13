const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const {
  mkdtemp,
  writeFile,
  readFile,
  appendFile,
  readdir,
  rm,
} = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { resolve, sep } = require("node:path");
const { once } = require("node:events");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const exec = promisify(execFile);
const { MongoMemoryServer } = require("mongodb-memory-server");
const { rar } = require("./rar-fixture.cjs");
const { zip, tar, tgz } = require("./archive-fixture.cjs");
const backend = (name) =>
  require(
    process.env.TEST_BACKEND_SOURCE === "true"
      ? "../src/" + name + ".ts"
      : "../dist/" + name,
  );

let memory, directory, server, origin, cookie, db, appModule;
let pm2Calls;

before(
  async () => {
    directory = await mkdtemp(resolve(tmpdir(), "monitor-integration-"));
    memory = await MongoMemoryServer.create();
    const logPath = resolve(directory, "app.log");
    pm2Calls = resolve(directory, "pm2-calls.jsonl");
    await writeFile(logPath, "primeiro log\n");
    const pm2Script = resolve(directory, "fake-pm2.cjs");
    await writeFile(
      pm2Script,
      `
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === 'jlist') console.log(JSON.stringify([{pm_id:3,name:'app',pm2_env:{status:'online',PORT:'3100',env:{PORT:'3100',SECRET:'not-for-api'},pm_out_log_path:${JSON.stringify(logPath)},pm_err_log_path:${JSON.stringify(logPath)}}}]));
else { fs.appendFileSync(${JSON.stringify(pm2Calls)}, JSON.stringify({args,cwd:process.cwd()}) + '\\n'); if (args[0] === 'startOrReload' && args[1].includes('FAIL')) process.exit(1); }
`,
    );
    // Também isola um eventual deploy real no teste do código TypeScript.
    const preload = resolve(directory, "isolate-pm2.cjs");
    const unique = directory.split(/[\\/]/).pop();
    const socket = (name) =>
      process.platform === "win32"
        ? `\\\\.\\pipe\\${unique}-${name}`
        : resolve(directory, `${name}.sock`);
    await writeFile(
      preload,
      `const conf = require(${JSON.stringify(require.resolve("pm2/constants"))});
conf.DAEMON_RPC_PORT=${JSON.stringify(socket("rpc"))}; conf.DAEMON_PUB_PORT=${JSON.stringify(socket("pub"))}; conf.INTERACTOR_RPC_PORT=${JSON.stringify(socket("interactor"))};`,
    );
    Object.assign(process.env, {
      MONGODB_URI: memory.getUri(),
      MONGODB_DATABASE: "monitor_integration",
      ADMIN_USERNAME: "admin",
      ADMIN_PASSWORD: "test-password-12345",
      JWT_SECRET: "test-secret-with-more-than-thirty-two-characters",
      VERSIONS_DIR: resolve(directory, "versions"),
      PM2_SCRIPT: pm2Script,
      UPLOAD_MAX_MB: "1",
      EXTRACTED_MAX_MB: "2",
      COOKIE_SECURE: "false",
      PM2_HOME: resolve(directory, "pm2"),
      NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --require ${JSON.stringify(preload)}`,
      // Mesmo uma configuração antiga inválida não pode bloquear a API.
      VPN_ALLOWED_CIDRS: "invalid-legacy-value",
    });
    appModule = backend("main");
    db = backend("common/database");
    // O deploy real é coberto em deployment.test.cjs com pipes isolados.
    if (process.env.TEST_BACKEND_SOURCE !== "true") {
      backend("pm2/pm2.service").deployEcosystem = async (path) => {
        await appendFile(pm2Calls, JSON.stringify({ path }) + "\n");
      };
    }
    await appModule.initialize();
    server = appModule.app.listen(0, "0.0.0.0");
    await once(server, "listening");
    origin = `http://127.0.0.1:${server.address().port}`;
  },
  { timeout: 120000 },
);

after(async () => {
  if (server) await new Promise((resolveClose) => server.close(resolveClose));
  if (db) await db.mongo.close();
  if (memory) await memory.stop();
  if (process.env.TEST_BACKEND_SOURCE === "true") {
    await exec(process.execPath, [require.resolve("pm2/bin/pm2"), "kill"], {
      env: process.env,
      windowsHide: true,
      timeout: 20000,
    });
  }
  // O diretório é criado por mkdtemp neste teste, nunca aponta para a workspace.
  if (
    directory &&
    directory.startsWith(resolve(tmpdir()) + sep) &&
    directory.includes("monitor-integration-")
  ) {
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200,
    });
  }
});

async function request(path, options = {}) {
  const headers = new Headers(options.headers);
  if (cookie) headers.set("cookie", cookie);
  if (typeof options.body === "string")
    headers.set("content-type", "application/json");
  return fetch(origin + path, { ...options, headers });
}

async function upload(version, bytes, project = "app", filename = "build.rar") {
  const data = new FormData();
  data.set("project", project);
  data.set("version", version);
  data.set("build", new Blob([bytes]), filename);
  return request("/api/versions", { method: "POST", body: data });
}

test("network access, MongoDB authentication, builds, deployment and persisted logs", async (t) => {
  const archive = rar([
    [
      "release/ecosystem.config.js",
      'module.exports={apps:[{name:"app",script:"./dist/main.js"}]}',
    ],
    ["release/dist/main.js", 'console.log("build pronto");'],
  ]);
  let version;

  await t.test(
    "accepts requests with legacy VPN config while retaining authentication",
    async () => {
      assert.equal((await request("/api/health")).status, 200);
      assert.equal((await request("/api/users")).status, 401);
      assert.equal((await request("/api/processes/stream")).status, 401);
      const noAuth = await upload("1.0.0", archive);
      assert.equal(noAuth.status, 401);
      assert.deepEqual(
        await readdir(resolve(directory, "versions", ".uploads")),
        [],
      );
      const malformed = await fetch(origin + "/api/auth/me", {
        headers: { cookie: "pm2_session=%ZZ" },
      });
      assert.equal(malformed.status, 401);
    },
  );

  await t.test(
    "bootstraps user once and authenticates against hashed MongoDB credentials",
    async () => {
      const stored = await db.users.findOne({ username: "admin" });
      assert.match(stored.passwordHash, /^scrypt:/);
      assert.ok(!stored.passwordHash.includes(process.env.ADMIN_PASSWORD));
      const wrong = await request("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: "admin", password: "wrong" }),
      });
      assert.equal(wrong.status, 401);
      const login = await request("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          username: "ADMIN",
          password: process.env.ADMIN_PASSWORD,
        }),
      });
      assert.equal(login.status, 200);
      cookie = login.headers.get("set-cookie").split(";")[0];
      assert.match(login.headers.get("set-cookie"), /HttpOnly/);
      await appModule.initialize();
      assert.equal(await db.users.countDocuments(), 1);
    },
  );

  await t.test(
    "returns process ports without exposing environment variables",
    async () => {
      const response = await request("/api/processes");
      assert.equal(response.status, 200);
      const rows = await response.json();
      assert.deepEqual(rows[0].ports, [3100]);
      assert.equal(rows[0].portSource, "configured");
      assert.ok(!JSON.stringify(rows).includes("not-for-api"));
    },
  );

  await t.test(
    "streams authenticated metrics immediately without compression",
    { timeout: 15000 },
    async () => {
      const controller = new AbortController();
      const response = await request("/api/processes/stream", {
        signal: controller.signal,
        headers: { "accept-encoding": "gzip" },
      });
      try {
        assert.equal(response.status, 200);
        assert.match(
          response.headers.get("content-type"),
          /text\/event-stream/,
        );
        assert.equal(response.headers.get("content-encoding"), null);
        assert.equal(response.headers.get("x-accel-buffering"), "no");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let received = "";
        while (!received.includes("event: processes\n")) {
          const { value, done } = await reader.read();
          assert.equal(done, false);
          received += decoder.decode(value, { stream: true });
        }
        assert.match(received, /"name":"app"/);
        assert.ok(!received.includes("not-for-api"));
      } finally {
        controller.abort();
      }
    },
  );

  await t.test(
    "creates users, rejects duplicates and weak passwords, never exposes hashes",
    async () => {
      const create = await request("/api/users", {
        method: "POST",
        body: JSON.stringify({
          username: "Operador",
          password: "another-password-123",
        }),
      });
      assert.equal(create.status, 201);
      assert.equal((await create.json()).username, "operador");
      const duplicate = await request("/api/users", {
        method: "POST",
        body: JSON.stringify({
          username: "OPERADOR",
          password: "another-password-123",
        }),
      });
      assert.equal(duplicate.status, 409);
      const weak = await request("/api/users", {
        method: "POST",
        body: JSON.stringify({ username: "weak", password: "123" }),
      });
      assert.equal(weak.status, 400);
      const list = await (await request("/api/users")).text();
      assert.ok(!list.includes("passwordHash"));
      assert.ok(!list.includes("scrypt"));
      const login = await request("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          username: "operador",
          password: "another-password-123",
        }),
      });
      assert.equal(login.status, 200);
    },
  );

  await t.test(
    "only database administrators can list or create users, including legacy sessions",
    async () => {
      assert.equal(
        (await (await request("/api/auth/me")).json()).role,
        "admin",
      );
      const login = await request("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          username: "operador",
          password: "another-password-123",
        }),
      });
      const userCookie = login.headers.get("set-cookie").split(";")[0];
      const userRequest = (path, options = {}) =>
        fetch(origin + path, {
          ...options,
          headers: { cookie: userCookie, "content-type": "application/json" },
        });
      assert.equal(
        (await (await userRequest("/api/auth/me")).json()).role,
        "user",
      );
      assert.equal((await userRequest("/api/users")).status, 403);
      assert.equal(
        (
          await userRequest("/api/users", {
            method: "POST",
            body: JSON.stringify({
              username: "forbidden",
              password: "password-long-enough",
              role: "admin",
            }),
          })
        ).status,
        403,
      );
      assert.equal(await db.users.findOne({ username: "forbidden" }), null);
      // Old releases signed role=admin into every session; the DB must be authoritative.
      const header = Buffer.from(
        JSON.stringify({ alg: "HS256", typ: "JWT" }),
      ).toString("base64url");
      const claims = Buffer.from(
        JSON.stringify({
          sub: "operador",
          role: "admin",
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
      ).toString("base64url");
      const signature = require("node:crypto")
        .createHmac("sha256", process.env.JWT_SECRET)
        .update(`${header}.${claims}`)
        .digest("base64url");
      assert.equal(
        (
          await fetch(origin + "/api/users", {
            headers: { cookie: `pm2_session=${header}.${claims}.${signature}` },
          })
        ).status,
        403,
      );
      await db.users.updateMany(
        { username: { $in: ["admin", "operador"] } },
        { $unset: { role: "" } },
      );
      await backend("auth/users.service").bootstrapUser();
      assert.equal(
        (await db.users.findOne({ username: "admin" })).role,
        "admin",
      );
      assert.equal(
        (await db.users.findOne({ username: "operador" })).role,
        "user",
      );
      await backend("auth/users.service").bootstrapUser();
      assert.equal((await request("/api/users")).status, 200);
      const promoted = await request("/api/users", {
        method: "POST",
        body: JSON.stringify({
          username: "another-admin",
          password: "another-admin-password",
          role: "admin",
        }),
      });
      assert.equal(promoted.status, 201);
      assert.equal((await promoted.json()).role, "admin");
      assert.equal(
        (
          await request("/api/users", {
            method: "POST",
            body: JSON.stringify({
              username: "bad-role",
              password: "another-admin-password",
              role: "owner",
            }),
          })
        ).status,
        400,
      );
    },
  );

  await t.test(
    "extracts a real RAR, preserves exact archive, hash and metadata",
    async () => {
      const response = await upload("1.0.0", archive);
      assert.equal(response.status, 201, await response.clone().text());
      version = await response.json();
      assert.equal(version.ecosystem, "release/ecosystem.config.js");
      assert.equal(version.status, "ready");
      assert.equal(version.createdBy, "admin");
      assert.equal(
        version.sha256,
        require("node:crypto")
          .createHash("sha256")
          .update(archive)
          .digest("hex"),
      );
      const path = resolve(directory, "versions", version._id);
      assert.deepEqual(await readFile(resolve(path, "build.rar")), archive);
      assert.equal(
        await readFile(
          resolve(path, "build", "release", "dist", "main.js"),
          "utf8",
        ),
        'console.log("build pronto");',
      );
      const download = await request(`/api/versions/${version._id}/archive`);
      assert.equal(download.status, 200);
      assert.deepEqual(Buffer.from(await download.arrayBuffer()), archive);
      assert.equal((await upload("1.0.0", archive)).status, 409);
      assert.equal(
        (await db.versions.findOne({ version: "1.0.0" })).status,
        "ready",
      );
    },
  );

  await t.test(
    "rejects fake, oversized, traversal and conflicting archives; cleans temporary files",
    async () => {
      assert.equal((await upload("bad", Buffer.from("not a rar"))).status, 400);
      assert.equal(
        (await upload("zip", archive, "app", "build.zip")).status,
        400,
      );
      assert.equal((await upload("../escape", archive)).status, 400);
      assert.equal(
        (await upload("large", Buffer.alloc(1024 * 1024 + 1))).status,
        413,
      );
      const large = rar([["large.txt", Buffer.alloc(2 * 1024 * 1024 + 1)]]);
      // O limite de extração é testado sem passar pelo limite menor de upload.
      const tmp = resolve(directory, "large.rar");
      await writeFile(tmp, large);
      const { saveBuild } = backend("versions/versions.service");
      await assert.rejects(
        saveBuild(
          { path: tmp, originalname: "large.rar", size: large.length },
          { project: "app", version: "expanded-large" },
          "admin",
        ),
        /descompactado/,
      );
      for (const name of [
        "../outside.txt",
        "/absolute.txt",
        "C:/absolute.txt",
        "dir/file:stream",
        "NUL.txt",
        "dir/../outside.txt",
      ]) {
        const response = await upload("unsafe", rar([[name, "invalid"]]));
        assert.equal(
          response.status,
          400,
          `${name}: ${await response.clone().text()}`,
        );
      }
      const conflict = await upload(
        "conflict",
        rar([
          ["Build.txt", "one"],
          ["build.txt", "two"],
        ]),
      );
      assert.equal(conflict.status, 400);
      assert.deepEqual(
        await readdir(resolve(directory, "versions", ".uploads")),
        [],
      );
      assert.equal(await db.versions.countDocuments(), 1);
    },
  );

  await t.test(
    "starts extracted ecosystem using the build directory and saves PM2 state",
    async () => {
      const response = await request(`/api/versions/${version._id}/start`, {
        method: "POST",
      });
      assert.equal(response.status, 204, await response.text());
      const calls = (await readFile(pm2Calls, "utf8"))
        .trim()
        .split("\n")
        .map(JSON.parse);
      if (process.env.TEST_BACKEND_SOURCE === "true") {
        assert.deepEqual(calls[0].args, ["save", "--force"]);
        const { stdout } = await exec(
          process.execPath,
          [require.resolve("pm2/bin/pm2"), "jlist"],
          { env: process.env, windowsHide: true },
        );
        const rows = JSON.parse(stdout.slice(stdout.indexOf("[{")));
        assert.equal(
          rows[0].pm2_env.pm_exec_path,
          resolve(
            directory,
            "versions",
            version._id,
            "build",
            "release",
            "dist",
            "main.js",
          ),
        );
      } else {
        assert.equal(
          calls[0].path,
          resolve(
            directory,
            "versions",
            version._id,
            "build",
            "release",
            "ecosystem.config.js",
          ),
        );
      }
      assert.equal(
        (await db.versions.findOne({ version: "1.0.0" })).status,
        "started",
      );
      const responseNoConfig = await upload(
        "static",
        rar([["index.html", "<h1>ready</h1>"]]),
      );
      assert.equal(responseNoConfig.status, 201);
      const staticVersion = await responseNoConfig.json();
      assert.equal(
        (
          await request(`/api/versions/${staticVersion._id}/start`, {
            method: "POST",
          })
        ).status,
        400,
      );
    },
  );

  await t.test(
    "persists audit and incremental process logs across collector restarts and file truncation",
    async () => {
      const { collectProcessLogs } = backend("logs/logs.service");
      const live = [];
      await collectProcessLogs(row => live.push(row));
      assert.equal(live.length, 1);
      assert.equal(live[0].content, "primeiro log\n");
      assert.match(live[0]._id, /^[a-f0-9]{24}$/);
      assert.equal(await db.logs.countDocuments({ kind: "process" }), 1);
      await collectProcessLogs();
      assert.equal(await db.logs.countDocuments({ kind: "process" }), 1);
      await appendFile(resolve(directory, "app.log"), "ação concluída 🚀\n");
      await collectProcessLogs();
      const output = await db.logs
        .find({ kind: "process" })
        .sort({ createdAt: 1 })
        .toArray();
      assert.equal(
        output.map((item) => item.content).join(""),
        "primeiro log\nação concluída 🚀\n",
      );
      await writeFile(resolve(directory, "app.log"), "novo\n");
      await collectProcessLogs();
      assert.equal(await db.logs.countDocuments({ kind: "process" }), 3);
      const audit = await (await request("/api/logs?kind=audit")).json();
      assert.ok(
        audit.some(
          (item) => item.path === "/api/auth/login" && item.status === 401,
        ),
      );
      assert.ok(
        audit.some(
          (item) =>
            item.path === "/api/users" &&
            item.status === 201 &&
            item.username === "admin",
        ),
      );
      assert.ok(!JSON.stringify(audit).includes(process.env.ADMIN_PASSWORD));
      const archived = await (
        await request("/api/logs?kind=process&processId=3")
      ).json();
      assert.equal(archived.length, 3);
      assert.equal((await request("/api/logs?limit=NaN")).status, 400);
      assert.equal((await request("/api/logs?kind=other")).status, 400);
      assert.equal((await fetch(origin + "/api/logs/stream?processName=app")).status, 401);
      assert.equal((await request("/api/logs/stream")).status, 400);
      const controller = new AbortController();
      try {
        const name = output[0].processName;
        const stream = await request(`/api/logs/stream?processName=${encodeURIComponent(name)}&namespace=default`, { signal: controller.signal });
        assert.equal(stream.headers.get("content-encoding"), null);
        assert.match(stream.headers.get("content-type"), /text\/event-stream/);
        const reader = stream.body.getReader();
        let frames = "";
        while (!frames.includes("event: snapshot")) {
          const { value, done } = await reader.read();
          assert.equal(done, false);
          frames += Buffer.from(value).toString("utf8");
        }
        assert.match(frames, /primeiro log/);
        await reader.cancel();
      } finally { controller.abort(); }
    },
  );

  const packedEntries = [
    ["./release/ecosystem.config.js", "module.exports={apps:[]};"],
    ["./release/main.js", 'console.log("compactado");'],
  ];
  const formats = [
    [".zip", () => zip(packedEntries)],
    [".ZIP", () => zip(packedEntries)],
    [".tar", () => tar([["./", "", { type: "5" }], ...packedEntries])],
    [".tar.gz", () => tgz(packedEntries)],
    [".tgz", () => tgz(packedEntries)],
    [".7z", () => readFile(resolve(__dirname, "fixtures/build.7z"))],
    [".tar.bz2", () => readFile(resolve(__dirname, "fixtures/build.tar.bz2"))],
    [".tbz2", () => readFile(resolve(__dirname, "fixtures/build.tar.bz2"))],
    [".tbz", () => readFile(resolve(__dirname, "fixtures/build.tar.bz2"))],
    [".tar.xz", () => readFile(resolve(__dirname, "fixtures/build.tar.xz"))],
    [".txz", () => readFile(resolve(__dirname, "fixtures/build.tar.xz"))],
  ];
  for (const [index, [extension, makeArchive]] of formats.entries()) {
    await t.test(
      `uploads, extracts and downloads ${extension} with its original extension`,
      async () => {
        const bytes = await makeArchive();
        const response = await upload(
          `packed-${index}`,
          bytes,
          "packed",
          `build${extension}`,
        );
        assert.equal(response.status, 201, await response.clone().text());
        const saved = await response.json();
        assert.equal(saved.ecosystem, "release/ecosystem.config.js");
        const path = resolve(directory, "versions", saved._id);
        assert.deepEqual(
          await readFile(resolve(path, `build${extension.toLowerCase()}`)),
          bytes,
        );
        assert.equal(
          await readFile(resolve(path, "build/release/main.js"), "utf8"),
          'console.log("compactado");',
        );
        const download = await request(`/api/versions/${saved._id}/archive`);
        assert.equal(download.status, 200);
        assert.ok(
          download.headers
            .get("content-disposition")
            .includes(`packed-packed-${index}${extension.toLowerCase()}`),
        );
        assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
        assert.equal(
          (
            await request(`/api/versions/${saved._id}/start`, {
              method: "POST",
            })
          ).status,
          204,
        );
      },
    );
  }

  await t.test(
    "rejects unsafe ZIP/TAR entries, passwords, corrupt data and expanded size limits",
    async () => {
      const count = await db.versions.countDocuments();
      for (const [extension, pack] of [
        [".zip", zip],
        [".tar", tar],
      ]) {
        for (const name of [
          "../outside.txt",
          "/absolute.txt",
          "C:/absolute.txt",
          "dir/file:stream",
          "NUL.txt",
          "dir/../outside.txt",
        ]) {
          const response = await upload(
            "unsafe-packed",
            pack([[name, "invalid"]]),
            "app",
            `build${extension}`,
          );
          assert.equal(
            response.status,
            400,
            `${extension} ${name}: ${await response.clone().text()}`,
          );
        }
        assert.equal(
          (
            await upload(
              "conflicting-packed",
              pack([
                ["Build.txt", "one"],
                ["build.txt", "two"],
              ]),
              "app",
              `build${extension}`,
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await upload(
              "prefix-packed",
              pack([
                ["dir", "one"],
                ["dir/main.js", "two"],
              ]),
              "app",
              `build${extension}`,
            )
          ).status,
          400,
        );
      }
      assert.equal(
        (
          await upload(
            "zip-link",
            zip([["link", "../outside", { mode: 0o120777 }]]),
            "app",
            "build.zip",
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await upload(
            "zip-password",
            zip([["secret", "secret", { encrypted: true }]]),
            "app",
            "build.zip",
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await upload(
            "tar-link",
            tar([["link", "", { type: "2", link: "../outside" }]]),
            "app",
            "build.tar",
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await upload(
            "tar-hardlink",
            tar([["link", "", { type: "1", link: "../outside" }]]),
            "app",
            "build.tar",
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await upload(
            "tar-root",
            tar([
              ["..", "", { type: "5" }],
              ["file", "data"],
            ]),
            "app",
            "build.tar",
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await upload(
            "zip-large",
            zip([["large", Buffer.alloc(2 * 1024 * 1024 + 1)]]),
            "app",
            "build.zip",
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await upload(
            "tar-large",
            tgz([["large", Buffer.alloc(2 * 1024 * 1024 + 1)]]),
            "app",
            "build.tgz",
          )
        ).status,
        400,
      );
      assert.equal(
        (await upload("unsupported", Buffer.from("data"), "app", "build.exe"))
          .status,
        400,
      );
      const corrupt = zip([["main.js", "hello world"]]);
      corrupt[corrupt.indexOf(Buffer.from("main.js")) + "main.js".length] ^=
        0xff;
      assert.equal(
        (await upload("zip-corrupt", corrupt, "app", "build.zip")).status,
        400,
      );
      assert.equal(await db.versions.countDocuments(), count);
      assert.deepEqual(
        await readdir(resolve(directory, "versions", ".uploads")),
        [],
      );
    },
  );

  await t.test(
    "streams entries larger than one read buffer without truncation",
    async () => {
      const text = 'console.log("chunk");\n'.repeat(10000);
      const response = await upload(
        "zip-chunks",
        zip([["main.js", text]]),
        "app",
        "build.zip",
      );
      assert.equal(response.status, 201, await response.clone().text());
      const saved = await response.json();
      assert.equal(
        await readFile(
          resolve(directory, "versions", saved._id, "build/main.js"),
          "utf8",
        ),
        text,
      );
    },
  );

  await t.test("process actions reject a reused identity before executing PM2", async () => {
    const count = (await readFile(pm2Calls, "utf8")).split("\n").length;
    const response = await request("/api/processes/3/stop", { method: "POST", body: JSON.stringify({ name: "old-app", namespace: "default" }) });
    assert.equal(response.status, 409);
    assert.match((await response.json()).message, /processo mudou/);
    assert.equal((await readFile(pm2Calls, "utf8")).split("\n").length, count);
  });

  await t.test("revokes session when its MongoDB user is removed", async () => {
    await db.users.deleteOne({ username: "admin" });
    assert.equal((await request("/api/auth/me")).status, 401);
  });
});
