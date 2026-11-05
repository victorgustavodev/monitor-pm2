export type Pm2Row = {
  pm_id: number;
  name?: string;
  pid?: number;
  monit?: { cpu?: number; memory?: number };
  pm2_env?: {
    status?: string;
    pm_uptime?: number;
    restart_time?: number;
    exec_mode?: string;
    version?: string;
    pm_out_log_path?: string;
    pm_err_log_path?: string;
    PORT?: unknown;
    port?: unknown;
    env?: Record<string, unknown>;
    args?: unknown;
  };
};

function isProcessList(value: unknown): value is Pm2Row[] {
  return Array.isArray(value) && value.every((row) =>
    row !== null && typeof row === 'object' &&
    Number.isSafeInteger(row.pm_id) && row.pm_id >= 0 &&
    (row.monit === undefined || (row.monit !== null && typeof row.monit === 'object')) &&
    (row.pm2_env === undefined || (row.pm2_env !== null && typeof row.pm2_env === 'object')),
  );
}

export function parsePm2Output(stdout: string): Pm2Row[] {
  // Os avisos do CLI (por exemplo, versões diferentes do daemon) podem vir
  // antes ou depois da lista. Não registrar a saída: ela contém envs dos apps.
  const clean = stdout.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').replace(/^\uFEFF/, '').trim();
  try {
    const value: unknown = JSON.parse(clean);
    if (isProcessList(value)) return value;
  } catch { /* Procurar um array completo após os avisos do CLI. */ }

  for (const match of clean.matchAll(/^\s*\[/gm)) {
    const start = match.index! + match[0].lastIndexOf('[');
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = start; index < clean.length; index++) {
      const char = clean[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
        continue;
      }
      if (char === '"') quoted = true;
      else if (char === '[') depth++;
      else if (char === ']' && --depth === 0) {
        try {
          const value: unknown = JSON.parse(clean.slice(start, index + 1));
          if (isProcessList(value)) return value;
        } catch { /* Uma linha como [PM2] não é a lista JSON. */ }
        break;
      }
    }
  }
  throw new Error(clean ? 'invalid-process-list' : 'empty-output');
}
