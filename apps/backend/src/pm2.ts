import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { env } from './config';
import { HttpError } from './http-error';

const execFileAsync = promisify(execFile);
export type ProcessAction = 'start' | 'restart' | 'stop' | 'delete';
export interface ProcessView {
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
    const detail = error && typeof error === 'object' && ('stderr' in error || 'message' in error)
      ? String(('stderr' in error && error.stderr) || ('message' in error && error.message) || 'Falha desconhecida').trim()
      : 'Falha desconhecida';
    throw new HttpError(502, `Falha ao executar PM2: ${detail}`);
  }
}

export async function startEcosystem(rawPath: unknown): Promise<void> {
  if (typeof rawPath !== 'string' || !isAbsolute(rawPath.trim())) {
    throw new HttpError(400, 'Informe o caminho absoluto do ecosystem.config.js na VM.');
  }
  const path = resolve(rawPath.trim());
  if (basename(path).toLowerCase() !== 'ecosystem.config.js') {
    throw new HttpError(400, 'Selecione um arquivo chamado ecosystem.config.js.');
  }
  const file = await stat(path).catch(() => null);
  if (!file?.isFile()) throw new HttpError(400, 'Arquivo não encontrado ou sem permissão de leitura na VM.');
  await run(['start', path], dirname(path));
  await run(['save', '--force']);
}

let pickerOpen = false;
export async function pickEcosystem(): Promise<string | null> {
  if (process.platform !== 'win32') throw new HttpError(400, 'O seletor está disponível somente no Windows.');
  if (pickerOpen) throw new HttpError(409, 'Já existe um seletor aberto na VM.');
  pickerOpen = true;
  try {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile', '-STA', '-File', resolve(__dirname, '../../../scripts/select-ecosystem.ps1'),
    ], { windowsHide: true, timeout: 120_000, maxBuffer: 16 * 1024 });
    return stdout.trim() || null;
  } catch {
    throw new HttpError(400, 'Não foi possível abrir o seletor na sessão Windows da VM. Cole o caminho completo no campo.');
  } finally {
    pickerOpen = false;
  }
}

export async function listProcesses(): Promise<ProcessView[]> {
  const { stdout } = await run(['jlist']);
  try {
    const rows = JSON.parse(stdout) as Array<Record<string, any>>;
    return rows.map((item) => ({
      id: Number(item.pm_id), name: String(item.name), status: String(item.pm2_env?.status ?? 'unknown'),
      pid: Number(item.pid ?? 0), cpu: Number(item.monit?.cpu ?? 0), memory: Number(item.monit?.memory ?? 0),
      uptime: item.pm2_env?.pm_uptime ? Number(item.pm2_env.pm_uptime) : null,
      restarts: Number(item.pm2_env?.restart_time ?? 0),
      mode: String(item.pm2_env?.exec_mode ?? 'unknown').replace('_mode', ''),
      version: item.pm2_env?.version ? String(item.pm2_env.version) : null,
    }));
  } catch {
    throw new HttpError(502, 'O PM2 retornou uma resposta inválida.');
  }
}

async function assertExists(id: number) {
  if (!(await listProcesses()).some((process) => process.id === id)) {
    throw new HttpError(404, 'Processo PM2 não encontrado.');
  }
}

export async function processAction(id: number, action: ProcessAction): Promise<void> {
  await assertExists(id);
  await run([action, String(id)]);
  if (action !== 'delete') await run(['save', '--force']);
}

export async function processLogs(id: number, lines = 100): Promise<string> {
  await assertExists(id);
  const safeLines = Number.isFinite(lines) ? Math.min(Math.max(Math.trunc(lines), 10), 500) : 100;
  const { stdout, stderr } = await run(['logs', String(id), '--nostream', '--raw', '--lines', String(safeLines)]);
  return `${stdout}${stderr}`.trim();
}
