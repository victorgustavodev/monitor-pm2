const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtemp, mkdir, writeFile, readFile, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { createBuildOperation, getBuildOperation, cancelBuildOperation, runBuildOperation, submitBuildOperation, activeBuildOperation, withManualProcessAction, listBuildOperations } = require("../dist/projects/build-progress");
const { prepareDeployment, restoreDeployment } = require("../dist/projects/project-deploy");

function operation() {
  const state = createBuildOperation("project", "tester");
  return getBuildOperation(state.id, "project", "tester");
}

test("reservations prevent competing users and process commands while allowing independent projects", async () => {
  const first = createBuildOperation("one", "alice");
  const second = createBuildOperation("two", "bob");
  try {
    assert.throws(() => createBuildOperation("one", "bob"), /publicação em andamento/);
    await assert.rejects(withManualProcessAction(async () => {}), /bloqueadas/);
    assert.equal(listBuildOperations("bob").find(row => row.id === first.id).canCancel, false);
    assert.equal(listBuildOperations("bob").find(row => row.id === second.id).canCancel, true);
  } finally {
    cancelBuildOperation(getBuildOperation(first.id, "one", "alice"));
    cancelBuildOperation(getBuildOperation(second.id, "two", "bob"));
  }
  await withManualProcessAction(async () => {
    assert.throws(() => createBuildOperation("three", "alice"), /ações dos processos/);
  });
});

test("abandoned reservations expire but uploads that have started retain their lock", () => {
  const abandoned = createBuildOperation("abandoned", "alice");
  const uploaded = createBuildOperation("uploading", "bob");
  const upload = getBuildOperation(uploaded.id, "uploading", "bob");
  submitBuildOperation(upload);
  assert.throws(() => submitBuildOperation(upload), /já foi iniciada/);
  const now = Date.now;
  try {
    Date.now = () => now() + 31 * 60_000;
    assert.equal(activeBuildOperation("abandoned"), undefined);
    assert.equal(activeBuildOperation("uploading"), upload);
    assert.equal(getBuildOperation(abandoned.id, "abandoned", "alice").state.status, "cancelled");
  } finally {
    Date.now = now;
    cancelBuildOperation(upload);
  }
});
test("publication progress is scoped and becomes non-cancellable at PM2 commit", async () => {
  const op = operation();
  assert.throws(() => getBuildOperation(op.state.id, "another", "tester"), /não encontrada/);
  assert.throws(() => getBuildOperation(op.state.id, "project", "another"), /não encontrada/);
  const updates = [];
  op.events.on("progress", () => updates.push(op.state.percent));
  await runBuildOperation(op, async control => {
    control.report(35, "Validando arquivos");
    control.report(85, "Iniciando aplicação no PM2", false);
    assert.throws(() => cancelBuildOperation(op), /finalizada no PM2/);
  });
  assert.deepEqual(updates, [35, 85, 100]);
  assert.equal(op.state.status, "succeeded");
  await assert.rejects(runBuildOperation(op, async () => {}), /já foi iniciada/);
});
test("cancelled uploads never start processing and errors remain in publication log", async () => {
  const op = operation();
  cancelBuildOperation(op);
  let processed = false;
  await assert.rejects(runBuildOperation(op, async control => {
    control.report(10, "Validando pacote recebido");
    processed = true;
  }), /cancelada/);
  assert.equal(processed, false);
  assert.equal(op.state.status, "cancelled");
  const failed = operation();
  await assert.rejects(runBuildOperation(failed, async () => { throw new Error("Script not found: dist/main.js"); }), /Script not found/);
  assert.equal(failed.state.status, "failed");
  assert.match(failed.state.logs.join("\n"), /Script not found/);
});
test("cancellation during file replacement restores original files before finishing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "monitor-progress-"));
  try {
    const root = join(directory, "app"), source = join(directory, "source"), attempt = join(directory, "attempt");
    await mkdir(root); await mkdir(source);
    for (const file of ["a.js", "b.js"]) {
      await writeFile(join(root, file), "old"); await writeFile(join(source, file), "new");
    }
    const op = operation();
    op.events.on("progress", () => { if (op.state.percent > 60) cancelBuildOperation(op); });
    await assert.rejects(runBuildOperation(op, async control => {
      const apply = await prepareDeployment(root, source, ["a.js", "b.js"], [], attempt, control);
      try { await apply(); } catch (error) { await restoreDeployment(root, attempt); throw error; }
    }), /cancelada/);
    assert.equal(op.state.status, "cancelled");
    for (const file of ["a.js", "b.js"]) assert.equal(await readFile(join(root, file), "utf8"), "old");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
