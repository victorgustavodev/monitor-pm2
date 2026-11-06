const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parsePm2Output } = require("../dist/pm2/pm2-output");

const rows = [
  {
    pm_id: 0,
    name: "Python [worker]",
    pm2_env: { status: "online" },
    monit: { cpu: 0, memory: 1 },
  },
];
const json = JSON.stringify(rows);

test("accepts normal, empty and BOM-prefixed lists", () => {
  assert.deepEqual(parsePm2Output(json), rows);
  assert.deepEqual(parsePm2Output("[]"), []);
  assert.deepEqual(parsePm2Output("\uFEFF" + json), rows);
});
test("extracts JSON surrounded by PM2 version and startup notices", () => {
  assert.deepEqual(
    parsePm2Output(
      "[PM2] Starting daemon\r\n\u001b[31m>>>> In-memory PM2 is out-of-date\u001b[0m\r\n" +
        json +
        "\n[PM2] notice",
    ),
    rows,
  );
});
test("handles pretty JSON, escaped quotes and brackets inside strings", () => {
  const complex = [
    { pm_id: 2, name: 'worker "[a]" \\ path', pm2_env: { status: "online" } },
  ];
  assert.deepEqual(
    parsePm2Output("notice\n" + JSON.stringify(complex, null, 2) + "\nnotice"),
    complex,
  );
});
test("rejects missing, truncated or unexpected lists", () => {
  for (const value of [
    "",
    "[PM2] notice",
    '{"error":"failed"}',
    '[{"pm_id":0}',
    "[null]",
    "[{}]",
    '[{"pm_id":0,"monit":null}]',
  ]) {
    assert.throws(() => parsePm2Output(value));
  }
});
