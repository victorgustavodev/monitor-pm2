const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createLogStream } = require("../dist/logs/log-stream");
class Client extends EventEmitter {
  frames = [];
  writableLength = 0;
  set(headers) { this.headers = headers; }
  flushHeaders() {}
  write(frame) { this.frames.push(frame); return true; }
  end() { this.writableEnded = true; this.emit("close"); }
  destroy() { this.destroyed = true; this.emit("close"); }
  events(name) { return this.frames.filter(frame => frame.startsWith(`event: ${name}\n`)).map(frame => JSON.parse(frame.split("\ndata: ")[1])); }
}
const row = (id, content, namespace = "default", processName = "app") => ({ _id: id, content, namespace, processName });

test("log stream merges initial history and concurrent output once, filters identities and caps terminal size", async t => {
  let finish;
  const stream = createLogStream(() => new Promise(resolve => { finish = resolve; }));
  t.after(() => stream.close());
  const client = new Client();
  const opening = stream.subscribe(client, { processName: "app", namespace: "default" }, Date.now() + 60000, async () => true);
  stream.publish(row("1", "first\n"));
  stream.publish(row("2", "second\n"));
  finish([row("1", "first\n")]);
  await opening;
  assert.deepEqual(client.events("snapshot"), [{ content: "first\nsecond\n" }]);
  stream.publish(row("3", "ignored", "other"));
  stream.publish(row("4", "ignored", "default", "other-app"));
  stream.publish({ ...row("5", "new process ID\n"), processId: 99 });
  assert.deepEqual(client.events("log"), [{ content: "new process ID\n" }]);
  stream.publish(row("6", "x".repeat(300000)));
  assert.equal(client.events("log").at(-1).content.length, 200000);
  client.writableLength = 2 * 1024 * 1024;
  stream.publish(row("7", "slow"));
  assert.equal(client.destroyed, true);
});

test("log streams report failures, recover, expire and release clients on disconnect", async t => {
  let valid = true;
  const stream = createLogStream(async () => [], 5);
  t.after(() => stream.close());
  const client = new Client();
  await stream.subscribe(client, { processName: "app" }, Date.now() + 60000, async () => valid);
  stream.status(false); stream.status(true);
  assert.equal(client.events("logs-error").length, 1);
  assert.equal(client.events("live").length, 1);
  valid = false;
  await new Promise(resolve => client.once("close", resolve));
  assert.equal(client.events("session-expired").length, 1);
  const before = client.frames.length;
  stream.publish(row("1", "after close"));
  assert.equal(client.frames.length, before);
  const expired = new Client();
  await stream.subscribe(expired, { processName: "app" }, Date.now() - 1, async () => true);
  await new Promise(resolve => expired.once("close", resolve));
  assert.equal(expired.events("session-expired").length, 1);
});

test("history failure ends the stream so reconnection can resynchronize", async () => {
  const stream = createLogStream(async () => { throw new Error("database unavailable"); });
  const client = new Client();
  await stream.subscribe(client, { processName: "app" }, Date.now() + 60000, async () => true);
  assert.equal(client.writableEnded, true);
  assert.equal(client.events("logs-error").length, 1);
  stream.close();
});
