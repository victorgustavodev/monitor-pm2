const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const backend = (name) =>
  require(
    process.env.TEST_BACKEND_SOURCE === "true"
      ? "../src/" + name + ".ts"
      : "../dist/" + name,
  );
const { createProcessStream } = backend("pm2/process-stream");

class Client extends EventEmitter {
  frames = [];
  destroyed = false;
  writableEnded = false;
  set(headers) {
    this.headers = headers;
  }
  flushHeaders() {}
  write(frame) {
    this.frames.push(frame);
    return true;
  }
  end() {
    this.writableEnded = true;
    this.emit("close");
  }
  destroy() {
    this.destroyed = true;
    this.emit("close");
  }
  events(type) {
    return this.frames.filter((frame) => frame.startsWith(`event: ${type}\n`));
  }
}

async function until(predicate) {
  const end = Date.now() + 2000;
  while (!predicate()) {
    assert.ok(Date.now() < end, "Timed out waiting for stream");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("shares collection, sends initial state and changes only, and stops when clients disconnect", async (t) => {
  let calls = 0;
  let rows = [{ id: 1, cpu: 1 }];
  const stream = createProcessStream(
    async () => {
      calls++;
      return rows;
    },
    15,
    20,
  );
  t.after(() => stream.close());
  const first = new Client();
  stream.subscribe(first, Date.now() + 60000);
  await until(() => first.events("processes").length === 1);
  assert.match(first.headers["Content-Type"], /text\/event-stream/);
  const second = new Client();
  const before = calls;
  stream.subscribe(second, Date.now() + 60000);
  assert.equal(calls, before);
  assert.equal(second.events("processes").length, 1);
  await until(() => calls >= 3 && first.frames.includes(": heartbeat\n\n"));
  assert.equal(first.events("processes").length, 1);
  rows = [{ id: 1, cpu: 20 }];
  await until(() => first.events("processes").length === 2);
  assert.deepEqual(first.events("processes"), second.events("processes"));
  first.end();
  second.end();
  const stoppedAt = calls;
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(calls, stoppedAt);
});

test("reports PM2 failure, sends unchanged metrics on recovery, and expires sessions", async (t) => {
  let fail = false;
  const stream = createProcessStream(
    async () => {
      if (fail) throw new Error("PM2 unavailable");
      return [{ id: 1, cpu: 1 }];
    },
    10,
    20,
  );
  t.after(() => stream.close());
  const client = new Client();
  stream.subscribe(client, Date.now() + 60000);
  await until(() => client.events("processes").length === 1);
  fail = true;
  await until(() => client.events("metrics-error").length === 1);
  fail = false;
  await until(() => client.events("processes").length === 2);
  const expired = new Client();
  stream.subscribe(expired, Date.now() - 1);
  await until(() => expired.writableEnded);
  assert.equal(expired.events("session-expired").length, 1);
  assert.equal(client.writableEnded, false);
  stream.close();
  assert.equal(client.writableEnded, true);
});

test("does not overlap slow collections and disconnects clients that cannot keep up", async (t) => {
  let finish,
    calls = 0;
  const stream = createProcessStream(
    () => {
      calls++;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
    10,
    1000,
  );
  t.after(() => stream.close());
  const client = new Client();
  stream.subscribe(client, Date.now() + 60000);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(calls, 1);
  client.write = () => false;
  finish([]);
  await until(() => client.destroyed);
});

test("terminates an open stream when its user is removed", async (t) => {
  let valid = true;
  const stream = createProcessStream(async () => [], 10, 10);
  t.after(() => stream.close());
  const client = new Client();
  stream.subscribe(client, Date.now() + 60000, async () => valid);
  await until(() => client.events("processes").length === 1);
  valid = false;
  await until(() => client.writableEnded);
  assert.equal(client.events("session-expired").length, 1);
});
