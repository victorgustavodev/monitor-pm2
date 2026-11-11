import { ObjectId } from "mongodb";
import { processInventory, processLabels, processProjects, projects, type ProcessInventoryRecord } from "../common/database";
import { processScope } from "./process-projects";
import type { ProcessView } from "./pm2.service";

// Remember identities, never PM2 IDs: the daemon may reuse them after restarting.
export async function includeUnstartedProcesses(current: ProcessView[]): Promise<ProcessView[]> {
  const scope = processScope();
  const identities = new Map(current.map(row => [JSON.stringify([row.name, row.namespace]), row]));
  const inventory: ProcessInventoryRecord[] = await processInventory.find({ scope }).toArray();
  for (const row of identities.values()) {
    const filter = { scope, name: row.name, namespace: row.namespace };
    const saved = inventory.find(item => item.name === row.name && item.namespace === row.namespace);
    if (row.projectId) {
      const projectId = new ObjectId(row.projectId);
      if (!saved?.projectId.equals(projectId)) {
        await processInventory.updateOne(filter, { $set: { projectId } }, { upsert: true });
        if (saved) saved.projectId = projectId;
        else inventory.push({ ...filter, projectId });
      }
    } else if (saved) {
      await processInventory.deleteOne(filter);
      inventory.splice(inventory.indexOf(saved), 1);
    }
  }
  const [catalog, links, labels] = await Promise.all([
    projects.find({ deleting: { $ne: true } }).sort({ nameKey: 1 }).toArray(),
    processProjects.find({ scope }).toArray(),
    processLabels.find({ scope }).toArray(),
  ]);
  const missing: ProcessView[] = [];
  for (const project of catalog) {
    const id = project._id.toHexString();
    const known = inventory.filter(row => {
      if (!row.projectId.equals(project._id)) return false;
      const link = links.find(link => link.name === row.name && link.namespace === row.namespace);
      return !link || link.projectId?.equals(project._id);
    });
    const absent = known.filter(row => !identities.has(JSON.stringify([row.name, row.namespace])))
      .map(({ name, namespace }) => ({ name, namespace }));
    // A newly registered project can start directly from its existing directory.
    if (!known.length && !current.some(row => row.projectId === id))
      absent.push({ name: project.name, namespace: "default" });
    for (const row of absent) {
      const metadata = known.length ? labels.find(label => label.name === row.name && label.namespace === row.namespace) : undefined;
      missing.push({
        id: `project:${id}:${JSON.stringify([row.name, row.namespace])}`,
        startProjectId: id, name: row.name, namespace: row.namespace,
        label: metadata?.label || "", labelUpdatedAt: metadata?.updatedAt.toISOString() || null,
        projectId: id, projectName: project.name, applicationUrl: project.applicationUrl || "",
        projectUpdatedAt: project.updatedAt.toISOString(), projectObservedAt: new Date().toISOString(),
        status: "not_started", pid: 0, cpu: 0, memory: 0, uptime: null,
        restarts: 0, mode: "—", version: null, ports: [], portSource: null,
      });
    }
  }
  return [...current, ...missing];
}
