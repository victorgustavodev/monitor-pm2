import { createHash } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import { containsPath } from "../projects/project-paths";
import type { Pm2Row } from "./pm2-output";

export function selectProjectProcesses(rows: Pm2Row[], root: string) {
  const linked = rows
    .flatMap((row) => {
      const cwd = row.pm2_env?.pm_cwd;
      const script = row.pm2_env?.pm_exec_path;
      if (!cwd || !script || !isAbsolute(cwd)) return [];
      const executable = resolve(cwd, script);
      if (!containsPath(root, cwd) && !containsPath(root, executable))
        return [];
      return [
        {
          id: row.pm_id,
          name: String(row.name || row.pm_id),
          status: String(row.pm2_env?.status || "unknown"),
          cwd: resolve(cwd),
          script: executable,
        },
      ];
    })
    .sort((a, b) => a.id - b.id);
  const revision = createHash("sha256")
    .update(
      JSON.stringify({
        root: resolve(root).toLowerCase(),
        processes: linked.map(({ status: _status, ...process }) => process),
      }),
    )
    .digest("hex");
  return {
    processes: linked.map(
      ({ cwd: _cwd, script: _script, ...process }) => process,
    ),
    revision,
  };
}
