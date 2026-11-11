import pm2, { type ProcessDescription, type StartOptions } from "pm2";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { cpus } from "node:os";
import { setTimeout as delay } from "node:timers/promises";

type AppConfig = StartOptions & {
  pm_exec_path: string;
  pm_cwd: string;
  namespace?: string;
};
type Pm2Process = Omit<ProcessDescription, "pm2_env"> & {
  pm2_env?: ProcessDescription["pm2_env"] & {
    namespace?: string;
    exec_mode?: string;
  };
};
// Use the installed PM2 parser and normalizer before removing any process.
const common = require("pm2/lib/Common") as {
  parseConfig: (
    bytes: Buffer,
    path: string,
  ) => { apps?: StartOptions[]; pm2?: StartOptions[] } | StartOptions[];
  verifyConfs: (apps: unknown) => StartOptions[] | Error;
  resolveAppAttributes: (
    options: { cwd: string; pm2_home: string },
    app: StartOptions,
  ) => AppConfig;
  mergeEnvironmentVariables: (app: AppConfig) => Record<string, unknown>;
};
const client = (
  pm2 as unknown as {
    Client: {
      executeRemote: (
        action: string,
        options: unknown,
        callback: (error: Error | null) => void,
      ) => void;
    };
  }
).Client;

function connect(): Promise<void> {
  return new Promise((resolveDone, reject) =>
    pm2.connect((error) => (error ? reject(error) : resolveDone())),
  );
}
function list(): Promise<Pm2Process[]> {
  return new Promise((resolveDone, reject) =>
    pm2.list((error, rows) => (error ? reject(error) : resolveDone(rows))),
  );
}

function matches(proc: Pm2Process, app: AppConfig) {
  return proc.name === app.name &&
    (proc.pm2_env?.namespace || "default") === (app.namespace || "default");
}

async function verifyStarted(apps: AppConfig[]) {
  const deadline = Date.now() + 10_000;
  let stableSince = 0, previous = "", diagnostic = "";
  do {
    const rows = await list();
    const signatures: unknown[] = [];
    const failures: string[] = [];
    for (const app of apps) {
      const instances = app.instances === undefined ? 1 : String(app.instances) === "max" ? 0 : Number(app.instances);
      const expected = Math.max(1, instances <= 0 ? cpus().length + instances : instances);
      const matching = rows.filter(proc => matches(proc, app));
      if (matching.length !== expected || matching.some(proc =>
        proc.pm2_env?.status !== "online" || !proc.pid ||
        proc.pm2_env.pm_exec_path !== app.pm_exec_path || proc.pm2_env.pm_cwd !== app.pm_cwd))
        failures.push(`${app.name} (${app.namespace || "default"}): ${matching.map(proc => proc.pm2_env?.status || "unknown").join(", ") || "não iniciada"}`);
      signatures.push(matching.map(proc => [proc.pm_id, proc.pid, proc.pm2_env?.restart_time]));
    }
    diagnostic = failures.join("; ");
    const signature = JSON.stringify(signatures);
    if (failures.length || signature !== previous) stableSince = 0;
    if (!failures.length) {
      stableSince ||= Date.now();
      if (Date.now() - stableSince >= 1_000) return;
    }
    previous = signature;
    await delay(250);
  } while (Date.now() < deadline);
  throw new Error(`As aplicações não permaneceram online com a configuração publicada: ${diagnostic || "processos reiniciando durante a verificação"}. Confira os logs.`);
}

async function deploy() {
  const path = resolve(process.argv[2]);
  const original = common.parseConfig(readFileSync(path), path);
  if (!original || typeof original !== "object")
    throw new Error("Ecosystem inválido.");
  const definitions = Array.isArray(original)
    ? original
    : original.apps || original.pm2 || original;
  const validated = common.verifyConfs(definitions);
  if (validated instanceof Error) throw validated;
  if (!validated.length) throw new Error("Ecosystem sem processos.");
  const pm2Home = (require("pm2/constants") as { PM2_HOME: string }).PM2_HOME;
  const names = new Set<string>();
  // Todos os scripts são verificados antes de alterar processos existentes.
  const apps = validated.map((app) => {
    const cwd = resolve(dirname(path), app.cwd || ".");
    const normalized = common.resolveAppAttributes(
      { cwd, pm2_home: pm2Home },
      { ...app, cwd },
    );
    normalized.namespace ||= "default";
    const key = JSON.stringify([normalized.namespace || "default", normalized.name]);
    if (names.has(key))
      throw new Error("O ecosystem contém nomes de processos duplicados.");
    names.add(key);
    return normalized;
  });
  await connect();
  try {
    const processes = await list();
    for (const proc of processes.filter(proc => apps.some(app => matches(proc, app)))) {
      const current = (await list()).find(row => row.pm_id === proc.pm_id);
      if (!current || current.name !== proc.name ||
          current.pm2_env?.namespace !== proc.pm2_env?.namespace ||
          current.pm2_env?.pm_exec_path !== proc.pm2_env?.pm_exec_path ||
          current.pm2_env?.pm_cwd !== proc.pm2_env?.pm_cwd || proc.pm_id === undefined)
        throw new Error("Os processos mudaram durante a publicação. Atualize a lista e tente novamente.");
      await new Promise<void>((resolveDone, reject) =>
        pm2.delete(proc.pm_id!, error => error ? reject(error) : resolveDone()));
    }
    for (const app of apps) {
      app.env = { ...app.env, PM2_HOME: pm2Home };
      const environment = common.mergeEnvironmentVariables(app);
      delete environment.current_conf;
      // PM2's public ecosystem start matches by name alone. Preparing a fresh
      // normalized app avoids restarting a same-name app in another namespace.
      await new Promise<void>((resolveDone, reject) =>
        client.executeRemote("prepare", { ...app, env: environment },
          error => error ? reject(error) : resolveDone()));
    }
    await verifyStarted(apps);
  } finally {
    pm2.disconnect();
  }
}

deploy().catch((error: unknown) => {
  pm2.disconnect();
  console.error(error instanceof Error ? error.message : "Falha no PM2.");
  process.exit(1);
});
