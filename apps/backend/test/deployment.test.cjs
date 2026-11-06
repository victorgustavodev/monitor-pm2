const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, mkdir, writeFile, readFile, rm } = require('node:fs/promises');
const { resolve, sep } = require('node:path');
const { tmpdir } = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);

test('deploys a new build and returns to an older version in an isolated PM2 daemon', { timeout: 90000 }, async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'monitor-deployment-'));
  const pm2Home = resolve(directory, 'pm2');
  const pm2Script = require.resolve('pm2/bin/pm2');
  const preload = resolve(directory, 'isolate-pm2.cjs');
  const unique = directory.split(/[\\/]/).pop();
  const rpc = process.platform === 'win32' ? `\\\\.\\pipe\\${unique}-rpc` : resolve(directory, 'rpc.sock');
  const pub = process.platform === 'win32' ? `\\\\.\\pipe\\${unique}-pub` : resolve(directory, 'pub.sock');
  const interactor = process.platform === 'win32' ? `\\\\.\\pipe\\${unique}-interactor` : resolve(directory, 'interactor.sock');
  // No Windows, PM2_HOME sozinho não isola os pipes do PM2. O preload é
  // herdado pelo daemon e define endpoints exclusivos para este teste.
  await writeFile(preload, `const conf = require(${JSON.stringify(require.resolve('pm2/constants'))});
conf.DAEMON_RPC_PORT=${JSON.stringify(rpc)}; conf.DAEMON_PUB_PORT=${JSON.stringify(pub)}; conf.INTERACTOR_RPC_PORT=${JSON.stringify(interactor)};`);
  const oldNodeOptions = process.env.NODE_OPTIONS;
  Object.assign(process.env, {
    PM2_HOME: pm2Home, PM2_SCRIPT: pm2Script,
    VERSIONS_DIR: resolve(directory, 'versions'),
    JWT_SECRET: 'deployment-test-secret-at-least-thirty-two-characters',
    NODE_OPTIONS: `${oldNodeOptions || ''} --require ${JSON.stringify(preload)}`,
    PM2_SILENT: 'true', PM2_USAGE: 'CLI',
  });
  const cli = (args, cwd = directory) => exec(process.execPath, [pm2Script, ...args], {
    cwd, env: process.env, windowsHide: true, timeout: 20000, maxBuffer: 2 * 1024 * 1024,
  });
  try {
    const probe = await exec(process.execPath, ['-e', `console.log(require(${JSON.stringify(require.resolve('pm2/constants'))}).DAEMON_RPC_PORT)`], {
      env: process.env, windowsHide: true,
    });
    assert.equal(probe.stdout.trim(), rpc, 'Nunca executar PM2 sem confirmar o isolamento dos endpoints.');
    const configs = [];
    for (const version of ['v1', 'v2']) {
      const build = resolve(directory, version);
      await mkdir(build);
      await writeFile(resolve(build, 'main.js'), `setInterval(() => {}, 1000); console.log('${version}');`);
      const config = resolve(build, 'ecosystem.config.js');
      await writeFile(config, `module.exports={apps:[{name:'isolated-build',script:'./main.js',exec_mode:'fork'}]};`);
      configs.push(config);
    }
    const { deployEcosystem } = require(process.env.TEST_BACKEND_SOURCE === 'true' ? '../src/pm2/pm2.service.ts' : '../dist/pm2/pm2.service');
    const { parsePm2Output } = require('../dist/pm2/pm2-output');
    let initialId;
    for (const index of [0, 1, 0]) {
      await deployEcosystem(configs[index]);
      const { stdout } = await cli(['jlist']);
      const processList = JSON.parse(stdout.slice(stdout.indexOf('[{')));
      assert.equal(processList.length, 1);
      const proc = processList[0];
      if (initialId === undefined) initialId = proc.pm_id;
      assert.equal(proc.pm_id, initialId);
      assert.equal(proc.pm2_env.pm_exec_path, resolve(directory, index === 0 ? 'v1' : 'v2', 'main.js'));
      assert.equal(proc.pm2_env.pm_cwd, resolve(directory, index === 0 ? 'v1' : 'v2'));
      assert.equal(proc.pm2_env.status, 'online');
      assert.equal(parsePm2Output(stdout).length, 1);
    }
    const invalid = resolve(directory, 'invalid');
    await mkdir(invalid);
    await writeFile(resolve(invalid, 'ecosystem.config.js'), "module.exports={apps:[{name:'isolated-build',script:'./missing.js'}]}");
    await assert.rejects(deployEcosystem(resolve(invalid, 'ecosystem.config.js')), /Script not found/);
    const running = await cli(['jlist']);
    assert.equal(JSON.parse(running.stdout.slice(running.stdout.indexOf('[{')))[0].pm2_env.pm_exec_path, resolve(directory, 'v1', 'main.js'));
    assert.match(await readFile(resolve(pm2Home, 'dump.pm2'), 'utf8'), /isolated-build/);
  } finally {
    await cli(['kill']).catch(() => { });
    if (oldNodeOptions === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = oldNodeOptions;
    if (directory.startsWith(resolve(tmpdir()) + sep) && directory.includes('monitor-deployment-')) {
      await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  }
});
