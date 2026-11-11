const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtemp, mkdir, writeFile, readFile, rm } = require("node:fs/promises");
const { resolve, sep } = require("node:path");
const { tmpdir } = require("node:os");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const exec = promisify(execFile);

test(
  "recreates builds, verifies executed code and isolates namespaces in a dedicated PM2 daemon",
  { timeout: 120000 },
  async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "monitor-deployment-"));
    const pm2Home = resolve(directory, "pm2");
    const pm2Script = require.resolve("pm2/bin/pm2");
    const preload = resolve(directory, "isolate-pm2.cjs");
    const unique = directory.split(/[\\/]/).pop();
    const rpc =
      process.platform === "win32"
        ? `\\\\.\\pipe\\${unique}-rpc`
        : resolve(directory, "rpc.sock");
    const pub =
      process.platform === "win32"
        ? `\\\\.\\pipe\\${unique}-pub`
        : resolve(directory, "pub.sock");
    const interactor =
      process.platform === "win32"
        ? `\\\\.\\pipe\\${unique}-interactor`
        : resolve(directory, "interactor.sock");
    // No Windows, PM2_HOME sozinho não isola os pipes do PM2. O preload é
    // herdado pelo daemon e define endpoints exclusivos para este teste.
    await writeFile(
      preload,
      `const conf = require(${JSON.stringify(require.resolve("pm2/constants"))});
conf.DAEMON_RPC_PORT=${JSON.stringify(rpc)}; conf.DAEMON_PUB_PORT=${JSON.stringify(pub)}; conf.INTERACTOR_RPC_PORT=${JSON.stringify(interactor)};`,
    );
    const oldNodeOptions = process.env.NODE_OPTIONS;
    Object.assign(process.env, {
      PM2_HOME: pm2Home,
      PM2_SCRIPT: pm2Script,
      VERSIONS_DIR: resolve(directory, "versions"),
      JWT_SECRET: "deployment-test-secret-at-least-thirty-two-characters",
      NODE_OPTIONS: `${oldNodeOptions || ""} --require ${JSON.stringify(preload)}`,
      PM2_SILENT: "true",
      PM2_USAGE: "CLI",
    });
    const cli = (args, cwd = directory) =>
      exec(process.execPath, [pm2Script, ...args], {
        cwd,
        env: process.env,
        windowsHide: true,
        timeout: 20000,
        maxBuffer: 2 * 1024 * 1024,
      });
    try {
      const probe = await exec(
        process.execPath,
        [
          "-e",
          `console.log(require(${JSON.stringify(require.resolve("pm2/constants"))}).DAEMON_RPC_PORT)`,
        ],
        {
          env: process.env,
          windowsHide: true,
        },
      );
      assert.equal(
        probe.stdout.trim(),
        rpc,
        "Nunca executar PM2 sem confirmar o isolamento dos endpoints.",
      );
      const configs = [];
      for (const version of ["v1", "v2"]) {
        const build = resolve(directory, version);
        await mkdir(build);
        await writeFile(
          resolve(build, "main.js"),
          `require('node:fs').writeFileSync('observed.json', JSON.stringify({version:'${version}',release:process.env.RELEASE,obsolete:process.env.OBSOLETE,pid:process.pid})); setInterval(() => {}, 1000);`,
        );
        const config = resolve(build, "ecosystem.config.js");
        await writeFile(
          config,
          `module.exports={apps:[{name:'isolated-build',script:'./main.js',exec_mode:'fork',env:{RELEASE:'${version}'${version === "v1" ? ",OBSOLETE:'remove-me'" : ""}}}]};`,
        );
        configs.push(config);
      }
      const {
        deployEcosystem,
        getProjectProcesses,
        stopProjectProcesses,
      } = require(
        process.env.TEST_BACKEND_SOURCE === "true"
          ? "../src/pm2/pm2.service.ts"
          : "../dist/pm2/pm2.service",
      );
      const { parsePm2Output } = require("../dist/pm2/pm2-output");
      const unrelatedScript = resolve(directory, "unrelated.js");
      await writeFile(unrelatedScript, "setInterval(() => {}, 1000);");
      await cli(["start", unrelatedScript, "--name", "isolated-build", "--namespace", "other"]);
      const unrelated = parsePm2Output((await cli(["jlist"])).stdout)[0];
      let previousPid;
      for (const index of [0, 1, 0]) {
        await deployEcosystem(configs[index]);
        const { stdout } = await cli(["jlist"]);
        const processList = JSON.parse(stdout.slice(stdout.indexOf("[{")));
        assert.equal(processList.length, 2);
        const proc = processList.find(row => row.pm2_env.namespace === "default");
        assert.notEqual(proc.pid, previousPid, "Each publication must create a fresh OS process");
        previousPid = proc.pid;
        assert.equal(processList.find(row => row.pm2_env.namespace === "other").pid, unrelated.pid);
        assert.equal(
          proc.pm2_env.pm_exec_path,
          resolve(directory, index === 0 ? "v1" : "v2", "main.js"),
        );
        assert.equal(
          proc.pm2_env.pm_cwd,
          resolve(directory, index === 0 ? "v1" : "v2"),
        );
        assert.equal(proc.pm2_env.status, "online");
        assert.equal(parsePm2Output(stdout).length, 2);
        const observed = JSON.parse(await readFile(resolve(directory, index === 0 ? "v1" : "v2", "observed.json"), "utf8"));
        assert.equal(observed.version, index === 0 ? "v1" : "v2");
        assert.equal(observed.release, observed.version);
        assert.equal(observed.pid, proc.pid);
        assert.equal(observed.obsolete, index === 0 ? "remove-me" : undefined, "Removed ecosystem variables cannot survive a new build");
      }
      // Project builds overwrite the same destination directory, unlike legacy version folders.
      await writeFile(resolve(directory, "v1", "main.js"), "require('node:fs').writeFileSync('observed.json',JSON.stringify({version:'patched-in-place',pid:process.pid}));setInterval(() => {},1000);");
      await deployEcosystem(configs[0]);
      const patched = JSON.parse(await readFile(resolve(directory, "v1", "observed.json"), "utf8"));
      assert.equal(patched.version, "patched-in-place");
      assert.notEqual(patched.pid, previousPid);
      const invalid = resolve(directory, "invalid");
      await mkdir(invalid);
      await writeFile(
        resolve(invalid, "ecosystem.config.js"),
        "module.exports={apps:[{name:'isolated-build',script:'./missing.js'}]}",
      );
      await assert.rejects(
        deployEcosystem(resolve(invalid, "ecosystem.config.js")),
        /Script not found/,
      );
      const running = await cli(["jlist"]);
      assert.equal(
        JSON.parse(running.stdout.slice(running.stdout.indexOf("[{"))).find(row => row.pm2_env.namespace === "default")
          .pm2_env.pm_exec_path,
        resolve(directory, "v1", "main.js"),
      );
      assert.match(
        await readFile(resolve(pm2Home, "dump.pm2"), "utf8"),
        /isolated-build/,
      );
      const preview = await getProjectProcesses(resolve(directory, "v1"));
      assert.equal(preview.processes.length, 1);
      assert.equal(preview.processes[0].name, "isolated-build");
      await assert.rejects(
        stopProjectProcesses(resolve(directory, "v1"), "outdated"),
        (error) => error.status === 409,
      );
      await stopProjectProcesses(resolve(directory, "v1"), preview.revision);
      const stopped = parsePm2Output((await cli(["jlist"])).stdout);
      assert.equal(stopped.length, 2, "Stopping keeps the process registered");
      assert.equal(stopped.find(row => row.pm2_env.namespace === "default").pm2_env.status, "stopped");
      assert.equal(
        JSON.parse(await readFile(resolve(pm2Home, "dump.pm2"), "utf8")).find(row => row.namespace === "default")
          .status,
        "stopped",
      );
      for (const instances of [2, 1]) {
        await writeFile(configs[0], `module.exports={apps:[{name:'isolated-build',script:'./main.js',exec_mode:'cluster',instances:${instances}}]};`);
        await deployEcosystem(configs[0]);
        const cluster = parsePm2Output((await cli(["jlist"])).stdout);
        assert.equal(cluster.filter(row => row.pm2_env.namespace === "default").length, instances);
        assert.ok(cluster.every(row => row.pm2_env.status === "online"));
        assert.equal(cluster.find(row => row.pm2_env.namespace === "other").pid, unrelated.pid);
      }
      await writeFile(resolve(invalid, "crash.js"), "throw new Error('startup failure');");
      await writeFile(resolve(invalid, "ecosystem.config.js"), "module.exports={apps:[{name:'crashing-build',script:'./crash.js',autorestart:false}]};");
      await assert.rejects(deployEcosystem(resolve(invalid, "ecosystem.config.js")), /não permaneceram online/);
      assert.equal(parsePm2Output((await cli(["jlist"])).stdout).find(row => row.pm2_env.namespace === "other").pid, unrelated.pid);
    } finally {
      await cli(["kill"]).catch(() => {});
      if (oldNodeOptions === undefined) delete process.env.NODE_OPTIONS;
      else process.env.NODE_OPTIONS = oldNodeOptions;
      if (
        directory.startsWith(resolve(tmpdir()) + sep) &&
        directory.includes("monitor-deployment-")
      ) {
        await rm(directory, {
          recursive: true,
          force: true,
          maxRetries: 10,
          retryDelay: 200,
        });
      }
    }
  },
);
