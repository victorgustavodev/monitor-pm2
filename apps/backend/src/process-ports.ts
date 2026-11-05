import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import type { Pm2Row } from './pm2-output';

interface SocketSnapshot {
  listeners: Array<{ pid: number; port: number }>;
  processes: Array<{ pid: number; parentPid: number }>;
}
export interface ProcessPorts {
  ports: number[];
  portSource: 'listening' | 'configured' | null;
}
const exec = promisify(execFile);
let cached: { snapshot: SocketSnapshot | null; expiresAt: number } | undefined;
let pending: Promise<SocketSnapshot | null> | undefined;

function validPort(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value.trim()))) return null;
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

export function configuredPorts(row: Pm2Row): number[] {
  const config = row.pm2_env;
  const values: unknown[] = [config?.PORT, config?.port, config?.env?.PORT];
  const args = config?.args;
  if (Array.isArray(args)) {
    for (let index = 0; index < args.length; index++) {
      const argument: unknown = args[index];
      if (typeof argument !== 'string') continue;
      if (argument === '--port' || argument === '-p') values.push(args[index + 1]);
      else if (argument.startsWith('--port=')) values.push(argument.slice(7));
    }
  } else if (typeof args === 'string') {
    for (const match of args.matchAll(/(?:^|\s)(?:--port(?:=|\s+)|-p\s+)["']?(\d+)["']?(?=\s|$)/g)) values.push(match[1]);
  }
  return [...new Set(values.map(validPort).filter((port): port is number => port !== null))].sort((a, b) => a - b);
}

export function portsForProcess(row: Pm2Row, snapshot: SocketSnapshot | null): ProcessPorts {
  const pid = Number(row.pid);
  const found = new Set<number>();
  if (snapshot && Number.isSafeInteger(pid) && pid > 0 && !['stopped', 'errored'].includes(row.pm2_env?.status || '')) {
    const children = new Map<number, number[]>();
    for (const process of snapshot.processes) {
      if (!Number.isSafeInteger(process.pid) || process.pid <= 0 || !Number.isSafeInteger(process.parentPid)) continue;
      const siblings = children.get(process.parentPid) || [];
      siblings.push(process.pid);
      children.set(process.parentPid, siblings);
    }
    const descendants = new Set<number>();
    const queue = [pid];
    for (let index = 0; index < queue.length; index++) {
      const current = queue[index];
      if (descendants.has(current)) continue;
      descendants.add(current);
      queue.push(...(children.get(current) || []));
    }
    for (const listener of snapshot.listeners) {
      const port = validPort(listener.port);
      if (descendants.has(listener.pid) && port !== null) found.add(port);
    }
  }
  if (found.size) return { ports: [...found].sort((a, b) => a - b), portSource: 'listening' };
  const configured = configuredPorts(row);
  return { ports: configured, portSource: configured.length ? 'configured' : null };
}

async function readSnapshot(): Promise<SocketSnapshot | null> {
  if (process.platform !== 'win32') return null;
  try {
    const { stdout } = await exec('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-File', resolve(__dirname, '../../../scripts/process-ports.ps1'),
    ], { windowsHide: true, timeout: 8000, maxBuffer: 2 * 1024 * 1024 });
    const snapshot: unknown = JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
    if (!snapshot || typeof snapshot !== 'object' || !('listeners' in snapshot) || !('processes' in snapshot) ||
      !Array.isArray(snapshot.listeners) || !Array.isArray(snapshot.processes)) return null;
    return snapshot as SocketSnapshot;
  } catch {
    // Uma falha de inspeção não deve impedir o monitoramento do PM2.
    return null;
  }
}

export async function inspectProcessPorts(rows: Pm2Row[]): Promise<ProcessPorts[]> {
  if (!rows.some((row) => Number.isSafeInteger(row.pid) && Number(row.pid) > 0)) {
    return rows.map((row) => portsForProcess(row, null));
  }
  if (!cached || cached.expiresAt <= Date.now()) {
    pending ??= readSnapshot().then((snapshot) => {
      cached = { snapshot, expiresAt: Date.now() + 5000 };
      return snapshot;
    }).finally(() => { pending = undefined; });
    await pending;
  }
  return rows.map((row) => portsForProcess(row, cached?.snapshot || null));
}
