import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, resolve } from "node:path";
import { env } from "../common/config";
import { HttpError } from "../common/http-error";
import { parsePm2Output } from "./pm2-output";
import { inspectProcessPorts, type ProcessPorts } from "./process-ports";
import { withArtifactAccess } from "../common/artifact-access";
import { homedir } from "node:os";
import { collectArtifactPaths, savedArtifactPaths } from "./artifact-paths";
import { selectProjectProcesses } from "./project-processes";

export const startEcosystem = (
  ...args: Parameters<typeof startEcosystemInternal>
) => withArtifactAccess(() => startEcosystemInternal(...args));
export const deployEcosystem = (
  ...args: Parameters<typeof deployEcosystemInternal>
) => withArtifactAccess(() => deployEcosystemInternal(...args));
export const processAction = (
  ...args: Parameters<typeof processActionInternal>
) => withArtifactAccess(() => processActionInternal(...args));

const execFileAsync = promisify(execFile);
export type ProcessAction = "start" | "restart" | "stop" | "delete";
export interface ProcessView extends ProcessPorts {
  id: number;
  name: string;
  status: string;
  pid: number;
  cpu: number;
  memory: number;
  uptime: number | null;
  restarts: number;
  mode: string;
  version: string | null;
}

async function run(args: string[], cwd?: string) {
  try {
    return await execFileAsync(process.execPath, [env.pm2Script, ...args], {
      windowsHide: true,
      cwd,
      timeout: 20_000,
      maxBuffer: 5 * 1024 * 1024,
      env: { ...process.env, PM2_HOME: env.pm2Home ?? process.env.PM2_HOME },
    });
  } catch (error: unknown) {
    const detail =
      error &&
      typeof error === "object" &&
      ("stderr" in error || "message" in error)
        ? String(
            ("stderr" in error && error.stderr) ||
              ("message" in error && error.message) ||
              "Falha desconhecida",
          ).trim()
        : "Falha desconhecida";
    throw new HttpError(502, `Falha ao executar PM2: ${detail}`);
  }
}

async function startEcosystemInternal(rawPath: unknown): Promise<void> {
  if (typeof rawPath !== "string" || !isAbsolute(rawPath.trim())) {
    throw new HttpError(
      400,
      "Informe o caminho absoluto do ecosystem.config.js na VM.",
    );
  }
  const path = resolve(rawPath.trim());
  if (basename(path).toLowerCase() !== "ecosystem.config.js") {
    throw new HttpError(
      400,
      "Selecione um arquivo chamado ecosystem.config.js.",
    );
  }
  const file = await stat(path).catch(() => null);
  if (!file?.isFile())
    throw new HttpError(
      400,
      "Arquivo não encontrado ou sem permissão de leitura na VM.",
    );
  await run(["start", path], dirname(path));
  await run(["save", "--force"]);
}

async function deployEcosystemInternal(path: string): Promise<void> {
  const extension = extname(__filename);
  const args =
    extension === ".ts" ? ["--require", require.resolve("tsx/cjs")] : [];
  try {
    await execFileAsync(
      process.execPath,
      [...args, resolve(__dirname, `deploy-worker${extension}`), path],
      {
        cwd: dirname(path),
        windowsHide: true,
        timeout: 60_000,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, PM2_HOME: env.pm2Home ?? process.env.PM2_HOME },
      },
    );
  } catch (error) {
    const detail =
      error && typeof error === "object" && "stderr" in error
        ? String(error.stderr).trim()
        : "";
    throw new HttpError(
      502,
      `Falha ao iniciar a versão no PM2: ${detail || "Operação interrompida ou tempo limite excedido."}`,
    );
  }
  await run(["save", "--force"]);
}

export async function processLogSources(): Promise<
  Array<{ id: number; name: string; path: string }>
> {
  const { stdout } = await run(["jlist"]);
  const rows = parsePm2Output(stdout);
  return rows.flatMap((item) => {
    const paths = [
      item.pm2_env?.pm_out_log_path,
      item.pm2_env?.pm_err_log_path,
    ];
    return [...new Set(paths)]
      .filter(
        (path): path is string => typeof path === "string" && isAbsolute(path),
      )
      .map((path) => ({
        id: Number(item.pm_id),
        name: String(item.name),
        path,
      }));
  });
}

let pickerOpen = false;
export async function pickEcosystem(): Promise<string | null> {
  if (process.platform !== "win32")
    throw new HttpError(400, "O seletor está disponível somente no Windows.");
  if (pickerOpen)
    throw new HttpError(409, "Já existe um seletor aberto na VM.");
  pickerOpen = true;
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-STA",
        "-File",
        resolve(__dirname, "../../../../scripts/select-ecosystem.ps1"),
      ],
      { windowsHide: true, timeout: 120_000, maxBuffer: 16 * 1024 },
    );
    return stdout.trim() || null;
  } catch {
    throw new HttpError(
      400,
      "Não foi possível abrir o seletor na sessão Windows da VM. Cole o caminho completo no campo.",
    );
  } finally {
    pickerOpen = false;
  }
}

async function processRows() {
  const { stdout } = await run(["jlist"]);
  let rows: ReturnType<typeof parsePm2Output>;
  try {
    rows = parsePm2Output(stdout);
  } catch {
    console.error("[PM2 jlist] Lista JSON ausente ou inválida.", {
      stdoutBytes: Buffer.byteLength(stdout),
    });
    throw new HttpError(
      502,
      "O comando PM2 jlist não retornou uma lista JSON válida. Confira a instalação do PM2, a conta Windows e o PM2_HOME usados pelo monitor.",
    );
  }
  return rows;
}

export async function listProcesses(): Promise<ProcessView[]> {
  const rows = await processRows();
  const ports = await inspectProcessPorts(rows);
  return rows.map((item, index) => ({
    ...ports[index],
    id: Number(item.pm_id),
    name: String(item.name),
    status: String(item.pm2_env?.status ?? "unknown"),
    pid: Number(item.pid ?? 0),
    cpu: Number(item.monit?.cpu ?? 0),
    memory: Number(item.monit?.memory ?? 0),
    uptime: item.pm2_env?.pm_uptime ? Number(item.pm2_env.pm_uptime) : null,
    restarts: Number(item.pm2_env?.restart_time ?? 0),
    mode: String(item.pm2_env?.exec_mode ?? "unknown").replace("_mode", ""),
    version: item.pm2_env?.version ? String(item.pm2_env.version) : null,
  }));
}

async function assertExists(id: number) {
  if (!(await processRows()).some((process) => process.pm_id === id)) {
    throw new HttpError(404, "Processo PM2 não encontrado.");
  }
}

export async function processArtifactPaths(): Promise<string[]> {
  const rows = await processRows();
  return [
    ...collectArtifactPaths(rows.map((row) => row.pm2_env)),
    ...(await savedArtifactPaths(env.pm2Home || resolve(homedir(), ".pm2"))),
  ];
}

export async function getProjectProcesses(root: string) {
  const rows = await processRows();
  try {
    collectArtifactPaths(rows.map((row) => row.pm2_env));
  } catch {
    throw new HttpError(
      502,
      "Não foi possível identificar com segurança os processos vinculados ao projeto.",
    );
  }
  return selectProjectProcesses(rows, root);
}

export async function stopProjectProcesses(root: string, revision: string) {
  return withArtifactAccess(async () => {
    const snapshot = await getProjectProcesses(root);
    if (snapshot.revision !== revision)
      throw new HttpError(
        409,
        "Os processos vinculados mudaram. Abra a confirmação de exclusão novamente.",
      );
    let stopped = 0;
    try {
      for (const process of snapshot.processes) {
        // Recheck identities before each action; never stop an ID that changed ownership.
        if ((await getProjectProcesses(root)).revision !== revision)
          throw new HttpError(
            409,
            "Os processos vinculados mudaram. Abra a confirmação de exclusão novamente.",
          );
        await run(["stop", String(process.id)]);
        stopped++;
      }
    } finally {
      if (stopped) await run(["save", "--force"]);
    }
  });
}

async function processActionInternal(
  id: number,
  action: ProcessAction,
): Promise<void> {
  await assertExists(id);
  await run([action, String(id)]);
  if (action !== "delete") await run(["save", "--force"]);
}

export async function processLogs(id: number, lines = 100): Promise<string> {
  await assertExists(id);
  const safeLines = Number.isFinite(lines)
    ? Math.min(Math.max(Math.trunc(lines), 10), 500)
    : 100;
  const { stdout, stderr } = await run([
    "logs",
    String(id),
    "--nostream",
    "--raw",
    "--lines",
    String(safeLines),
  ]);
  return `${stdout}${stderr}`.trim();
}
