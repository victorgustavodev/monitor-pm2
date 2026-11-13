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
import { createHash } from "node:crypto";
import { ObjectId } from "mongodb";
import { withProjectConfiguration } from "../projects/project-operations";
import { processIdentity, processScope, resolveProcessProjects } from "./process-projects";
import { processLabels, processProjects, processStartup, projects } from "../common/database";
import type { Pm2Row } from "./pm2-output";
import { withManualProcessAction } from "../projects/build-progress";
import { includeUnstartedProcesses } from "./process-inventory";

export const startEcosystem = (
  ...args: Parameters<typeof startEcosystemInternal>
) => withManualProcessAction(() => withArtifactAccess(() => startEcosystemInternal(...args)));
export const deployEcosystem = (
  ...args: Parameters<typeof deployEcosystemInternal>
) => withArtifactAccess(() => deployEcosystemInternal(...args));
export const processAction = (
  ...args: Parameters<typeof processActionInternal>
) => withArtifactAccess(() => args[1] === "delete"
  ? withProjectConfiguration(() => processActionInternal(...args))
  : processActionInternal(...args));

const execFileAsync = promisify(execFile);
export type ProcessAction = "start" | "restart" | "stop" | "delete";
export interface ProcessView extends ProcessPorts {
  projectId: string | null;
  projectName: string | null;
  projectUpdatedAt: string | null;
  projectObservedAt: string;
  label: string;
  labelUpdatedAt: string | null;
  namespace: string;
  id: number | string;
  startProjectId?: string;
  applicationUrl?: string;
  autoStart?: boolean;
  autoStartUpdatedAt?: string | null;
  autoStartError?: string;
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

export async function startSelectedProcess(path: string, projectRoot: string, name: string, namespace: string) {
  await deployEcosystemInternal(path, projectRoot, { name, namespace });
}
export async function validateStartupProcess(path: string, projectRoot: string, name: string, namespace: string) {
  await deployEcosystemInternal(path, projectRoot, { name, namespace, validate: true });
}

async function deployEcosystemInternal(path: string, projectRoot?: string, startup?: { name: string; namespace: string; validate?: boolean }): Promise<void> {
  const extension = extname(__filename);
  const args =
    extension === ".ts" ? ["--require", require.resolve("tsx/cjs")] : [];
  try {
    await execFileAsync(
      process.execPath,
      [...args, resolve(__dirname, `deploy-worker${extension}`), path, ...(projectRoot ? [projectRoot] : []),
        ...(startup ? [startup.validate ? "--validate-selected" : "--start-selected", startup.name, startup.namespace] : [])],
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
  if (!startup?.validate) await run(["save", "--force"]);
}

export async function processLogSources(): Promise<
  Array<{ id: number; name: string; namespace: string; path: string }>
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
        namespace: processIdentity(item).namespace,
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

export async function setProcessLabel(
  id: number,
  body: Record<string, unknown> | undefined,
  username: string,
) {
  const label = typeof body?.label === "string" ? body.label.trim() : null;
  if (label === null || label.length > 80 || /[\x00-\x1f\x7f]/.test(label))
    throw new HttpError(
      400,
      "Informe um nome de exibição de até 80 caracteres, sem quebras de linha.",
    );
  if (typeof body?.name !== "string" || typeof body?.namespace !== "string")
    throw new HttpError(
      400,
      "Atualize a lista de processos antes de salvar o nome.",
    );
  const row = (await processRows()).find((process) => process.pm_id === id);
  if (!row) throw new HttpError(404, "Processo PM2 não encontrado.");
  const identity = processIdentity(row);
  if (body.name !== identity.name || body.namespace !== identity.namespace)
    throw new HttpError(
      409,
      "O processo mudou. Atualize a lista antes de salvar o nome.",
    );
  const updatedAt = new Date();
  await processLabels.updateOne(
    { scope: processScope(), ...identity },
    {
      $set: { label, updatedAt, updatedBy: username },
      $setOnInsert: { createdAt: updatedAt },
    },
    { upsert: true },
  );
  return { ...identity, label, labelUpdatedAt: updatedAt.toISOString() };
}

export async function setProcessProject(
  id: number,
  body: Record<string, unknown> | undefined,
  username: string,
) {
  if (typeof body?.name !== "string" || typeof body?.namespace !== "string" ||
      (body.projectId !== null && (typeof body.projectId !== "string" || !/^[a-f0-9]{24}$/i.test(body.projectId))))
    throw new HttpError(400, "Informe o projeto e a identidade do processo.");
  return withProjectConfiguration(async () => {
    const project = body.projectId === null ? null : await projects.findOne({ _id: new ObjectId(body.projectId as string) });
    if (body.projectId !== null && !project) throw new HttpError(404, "Projeto não encontrado.");
    if (project?.deleting || project?.deployment)
      throw new HttpError(409, "Aguarde a conclusão da operação no projeto.");
    const row = (await processRows()).find(row => row.pm_id === id);
    if (!row) throw new HttpError(404, "Processo PM2 não encontrado.");
    const identity = processIdentity(row);
    if (body.name !== identity.name || body.namespace !== identity.namespace)
      throw new HttpError(409, "O processo mudou. Atualize a lista antes de vincular.");
    const previous = await processProjects.findOne({ scope: processScope(), ...identity });
    const updatedAt = new Date(Math.max(Date.now(), (previous?.updatedAt.getTime() || 0) + 1));
    await processProjects.updateOne({ scope: processScope(), ...identity }, {
      $set: { projectId: project?._id || null, updatedAt, updatedBy: username },
    }, { upsert: true });
    await processStartup.updateMany({ scope: processScope(), ...identity, ...(project ? { projectId: { $ne: project._id } } : {}) },
      { $set: { enabled: false, updatedAt }, $unset: { error: "" } });
    const startup = await processStartup.findOne({ scope: processScope(), ...identity });
    return { ...identity, projectId: project?._id.toHexString() || null,
      applicationUrl: project?.applicationUrl || "",
      autoStart: Boolean(startup?.enabled && startup.projectId.equals(project?._id)),
      autoStartUpdatedAt: startup?.updatedAt.toISOString() || null, autoStartError: startup?.error || "",
      projectName: project?.name || null, projectUpdatedAt: updatedAt.toISOString() };
  });
}

export async function listProcesses(): Promise<ProcessView[]> {
  const rows = await processRows();
  const ports = await inspectProcessPorts(rows);
  const projectLinks = await resolveProcessProjects(rows);
  const saved = rows.length
    ? await processLabels
        .find({
          scope: processScope(),
          name: { $in: rows.map((row) => processIdentity(row).name) },
        })
        .toArray()
    : [];
  const labels = new Map(
    saved.map((record) => [
      JSON.stringify([record.name, record.namespace]),
      record,
    ]),
  );
  const result = await includeUnstartedProcesses(rows.map((item, index) => {
    const identity = processIdentity(item);
    const metadata = labels.get(
      JSON.stringify([identity.name, identity.namespace]),
    );
    return {
      ...ports[index],
      ...projectLinks.get(item.pm_id)!,
      ...identity,
      label: metadata?.label || "",
      labelUpdatedAt: metadata?.updatedAt.toISOString() || null,
      id: Number(item.pm_id),
      status: String(item.pm2_env?.status ?? "unknown"),
      pid: Number(item.pid ?? 0),
      cpu: Number(item.monit?.cpu ?? 0),
      memory: Number(item.monit?.memory ?? 0),
      uptime: item.pm2_env?.pm_uptime ? Number(item.pm2_env.pm_uptime) : null,
      restarts: Number(item.pm2_env?.restart_time ?? 0),
      mode: String(item.pm2_env?.exec_mode ?? "unknown").replace("_mode", ""),
      version: item.pm2_env?.version ? String(item.pm2_env.version) : null,
    };
  }));
  const startup = await processStartup.find({ scope: processScope() }).toArray();
  return result.map(row => {
    const saved = startup.find(item => item.name === row.name && item.namespace === row.namespace);
    return { ...row, autoStart: Boolean(saved?.enabled && saved.projectId.toHexString() === row.projectId),
      autoStartUpdatedAt: saved?.updatedAt.toISOString() || null, autoStartError: saved?.error || "" };
  });
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

export async function getProjectProcesses(root: string, projectId?: string) {
  const rows = await processRows();
  try {
    collectArtifactPaths(rows.map((row) => row.pm2_env));
  } catch {
    throw new HttpError(
      502,
      "Não foi possível identificar com segurança os processos vinculados ao projeto.",
    );
  }
  if (!projectId) return selectProjectProcesses(rows, root);
  const links = await resolveProcessProjects(rows);
  const linked = rows.filter(row => links.get(row.pm_id)?.projectId === projectId).sort((a, b) => a.pm_id - b.pm_id);
  return {
    processes: linked.map(row => ({ id: row.pm_id, name: processIdentity(row).name, status: String(row.pm2_env?.status || "unknown") })),
    revision: createHash("sha256").update(JSON.stringify(linked.map(row => ({
      id: row.pm_id, ...processIdentity(row), cwd: row.pm2_env?.pm_cwd,
      script: row.pm2_env?.pm_exec_path, projectId,
    })))).digest("hex"),
  };
}

export async function stopProjectProcesses(root: string, revision: string, projectId?: string) {
  return withManualProcessAction(() => withArtifactAccess(async () => {
    const snapshot = await getProjectProcesses(root, projectId);
    if (snapshot.revision !== revision)
      throw new HttpError(
        409,
        "Os processos vinculados mudaram. Abra a confirmação de exclusão novamente.",
      );
    let stopped = 0;
    try {
      for (const process of snapshot.processes) {
        // Recheck identities before each action; never stop an ID that changed ownership.
        if ((await getProjectProcesses(root, projectId)).revision !== revision)
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
  }));
}

async function processActionInternal(
  id: number,
  action: ProcessAction,
  expected?: Record<string, unknown>,
): Promise<void> {
  const row = (await processRows()).find(process => process.pm_id === id);
  if (!row) throw new HttpError(404, "Processo PM2 não encontrado.");
  if (expected && (expected.name !== undefined || expected.namespace !== undefined)) {
    const identity = processIdentity(row);
    if (expected.name !== identity.name || expected.namespace !== identity.namespace)
      throw new HttpError(409, "O processo mudou. Atualize a lista antes de executar a ação.");
  }
  await run([action, String(id)]);
  if (action === "delete") await processStartup.updateOne({ scope: processScope(), ...processIdentity(row) },
    { $set: { enabled: false, updatedAt: new Date() }, $unset: { error: "" } });
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
