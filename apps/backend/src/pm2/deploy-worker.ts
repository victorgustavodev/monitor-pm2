import pm2, { type ProcessDescription, type StartOptions } from "pm2";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

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
// O CLI filtra pm_exec_path/pm_cwd no reload de um ecosystem. A API interna
// do PM2 fixado no package.json permite atualizar esses caminhos por ID.
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
    const key = `${normalized.namespace || "default"}:${normalized.name}`;
    if (names.has(key))
      throw new Error("O ecosystem contém nomes de processos duplicados.");
    names.add(key);
    return normalized;
  });
  await connect();
  try {
    const processes = await list();
    for (const app of apps) {
      const matching = processes.filter(
        (proc) =>
          proc.name === app.name &&
          (proc.pm2_env?.namespace || "default") ===
            (app.namespace || "default"),
      );
      if (!matching.length) {
        await new Promise<void>((resolveDone, reject) =>
          pm2.start(
            { ...app, script: app.pm_exec_path, cwd: app.pm_cwd },
            (error) => (error ? reject(error) : resolveDone()),
          ),
        );
      } else {
        for (const proc of matching) {
          const action =
            proc.pm2_env?.exec_mode === "cluster_mode"
              ? "reloadProcessId"
              : "restartProcessId";
          await new Promise<void>((resolveDone, reject) =>
            client.executeRemote(
              action,
              {
                id: proc.pm_id,
                env: { ...app.env, current_conf: app },
              },
              (error) => (error ? reject(error) : resolveDone()),
            ),
          );
        }
      }
    }
  } finally {
    pm2.disconnect();
  }
}

deploy().catch((error: unknown) => {
  pm2.disconnect();
  console.error(error instanceof Error ? error.message : "Falha no PM2.");
  process.exit(1);
});
