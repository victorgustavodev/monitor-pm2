import { homedir } from "node:os";
import { resolve } from "node:path";
import { env } from "../common/config";
import { processProjects, projects } from "../common/database";
import { selectProjectProcesses } from "./project-processes";
import type { Pm2Row } from "./pm2-output";

export function processScope() {
  const home = resolve(env.pm2Home || resolve(homedir(), ".pm2"));
  return process.platform === "win32" ? home.toLowerCase() : home;
}

export function processIdentity(row: Pm2Row) {
  return {
    name: String(row.name ?? row.pm_id),
    namespace: row.pm2_env?.namespace || "default",
  };
}

export async function resolveProcessProjects(rows: Pm2Row[]) {
  const observedAt = new Date().toISOString();
  const [catalog, links] = await Promise.all([
    projects.find({}).toArray(),
    processProjects.find({ scope: processScope() }).toArray(),
  ]);
  const saved = new Map(
    links.map(link => [JSON.stringify([link.name, link.namespace]), link]),
  );
  const byId = new Map(
    catalog.map(project => [project._id.toHexString(), project]),
  );
  const automatic = new Map<number, string>();
  for (const project of catalog) {
    for (const process of selectProjectProcesses(rows, project.rootPath).processes)
      automatic.set(process.id, project._id.toHexString());
  }
  return new Map(
    rows.map(row => {
      const identity = processIdentity(row);
      const link = saved.get(JSON.stringify([identity.name, identity.namespace]));
      // An explicit null keeps the process unlinked, even inside a project root.
      const id = link ? link.projectId?.toHexString() : automatic.get(row.pm_id);
      const project = id ? byId.get(id) : undefined;
      const updatedAt = Math.max(
        link?.updatedAt.getTime() || 0,
        project?.updatedAt.getTime() || 0,
      );
      return [row.pm_id, {
        projectObservedAt: observedAt,
        projectId: project?._id.toHexString() || null,
        projectName: project?.name || null,
        applicationUrl: project?.applicationUrl || "",
        projectUpdatedAt: updatedAt ? new Date(updatedAt).toISOString() : null,
      }];
    }),
  );
}
