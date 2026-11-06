import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

export function collectArtifactPaths(environments: unknown[]): string[] {
  return environments.flatMap((value) => {
    if (!value || typeof value !== "object")
      throw new Error("O PM2 não informou todos os caminhos; limpeza adiada.");
    const record = value as Record<string, unknown>;
    if (
      typeof record.pm_cwd !== "string" ||
      !isAbsolute(record.pm_cwd) ||
      typeof record.pm_exec_path !== "string" ||
      !record.pm_exec_path
    )
      throw new Error("O PM2 não informou todos os caminhos; limpeza adiada.");
    const paths = [
      resolve(record.pm_cwd),
      resolve(record.pm_cwd, record.pm_exec_path),
    ];
    for (const key of ["pm_out_log_path", "pm_err_log_path", "pm_pid_path"]) {
      const path = record[key];
      if (typeof path === "string" && isAbsolute(path))
        paths.push(resolve(path));
    }
    return paths;
  });
}

export async function savedArtifactPaths(home: string) {
  const paths: string[] = [];
  for (const name of ["dump.pm2", "dump.pm2.bak"]) {
    const source = await readFile(resolve(home, name), "utf8").catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      },
    );
    if (source === null) continue;
    let saved: unknown;
    try {
      saved = JSON.parse(source);
    } catch {
      throw new Error("Lista salva do PM2 inválida; limpeza adiada.");
    }
    if (!Array.isArray(saved))
      throw new Error("Lista salva do PM2 inválida; limpeza adiada.");
    paths.push(...collectArtifactPaths(saved));
  }
  return paths;
}
