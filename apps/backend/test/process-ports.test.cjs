const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const {
  configuredPorts,
  portsForProcess,
  inspectProcessPorts,
} = require("../dist/pm2/process-ports");

test("reads valid configured ports and CLI flags, without treating unrelated numbers as ports", () => {
  assert.deepEqual(
    configuredPorts({
      pm_id: 1,
      pm2_env: {
        PORT: "3000",
        port: 3000,
        env: { PORT: "8080" },
        args: ["--workers", "4", "--port", "9000", "--port=9100"],
      },
    }),
    [3000, 8080, 9000, 9100],
  );
  assert.deepEqual(
    configuredPorts({
      pm_id: 1,
      pm2_env: { args: '--workers 4 --port="5000" -p 5100' },
    }),
    [5000, 5100],
  );
  for (const value of [
    undefined,
    null,
    "",
    "0",
    "-1",
    "65536",
    "80.5",
    "8e3",
    true,
    {},
    ["3000"],
  ]) {
    assert.deepEqual(
      configuredPorts({ pm_id: 1, pm2_env: { PORT: value } }),
      [],
    );
  }
});

test("prefers real listeners, includes descendants, deduplicates IPv4/IPv6 and excludes unrelated processes", () => {
  const row = {
    pm_id: 1,
    pid: 100,
    pm2_env: { status: "online", PORT: "9999" },
  };
  const snapshot = {
    processes: [
      { pid: 100, parentPid: 1 },
      { pid: 101, parentPid: 100 },
      { pid: 102, parentPid: 101 },
      { pid: 200, parentPid: 1 },
    ],
    listeners: [
      { pid: 100, port: 3000 },
      { pid: 100, port: 3000 },
      { pid: 101, port: 5000 },
      { pid: 102, port: 8080 },
      { pid: 200, port: 27017 },
    ],
  };
  assert.deepEqual(portsForProcess(row, snapshot), {
    ports: [3000, 5000, 8080],
    portSource: "listening",
  });
  // Uma relação cíclica não pode travar a consulta.
  snapshot.processes.push({ pid: 100, parentPid: 102 });
  assert.deepEqual(portsForProcess(row, snapshot).ports, [3000, 5000, 8080]);
});

test("labels configuration separately and never reports a stopped process as listening", async () => {
  const snapshot = { processes: [], listeners: [{ pid: 100, port: 3000 }] };
  assert.deepEqual(
    portsForProcess(
      { pm_id: 1, pid: 100, pm2_env: { status: "stopped", PORT: "5000" } },
      snapshot,
    ),
    {
      ports: [5000],
      portSource: "configured",
    },
  );
  assert.deepEqual(
    portsForProcess({ pm_id: 1, pm2_env: { PORT: "5000" } }, null),
    { ports: [5000], portSource: "configured" },
  );
  assert.deepEqual(portsForProcess({ pm_id: 1 }, null), {
    ports: [],
    portSource: null,
  });
  assert.deepEqual(await inspectProcessPorts([{ pm_id: 1, pid: 0 }]), [
    { ports: [], portSource: null },
  ]);
});

test(
  "detects a real Windows TCP listener by PID and its parent process",
  { skip: process.platform !== "win32", timeout: 20000 },
  async (t) => {
    const child = spawn(
      process.execPath,
      [
        "-e",
        `
    const server = require('node:net').createServer();
    server.listen(0, '127.0.0.1', () => console.log(server.address().port));
  `,
      ],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit");
        child.kill();
        await exited;
      }
    });
    const [message] = await once(child.stdout, "data");
    const port = Number(String(message).trim());
    assert.ok(port > 0 && port <= 65535);
    const [direct, parent] = await inspectProcessPorts([
      { pm_id: 1, pid: child.pid, pm2_env: { status: "online" } },
      { pm_id: 2, pid: process.pid, pm2_env: { status: "online" } },
    ]);
    assert.equal(direct.portSource, "listening");
    assert.ok(direct.ports.includes(port), JSON.stringify(direct));
    assert.ok(parent.ports.includes(port), JSON.stringify(parent));
  },
);
