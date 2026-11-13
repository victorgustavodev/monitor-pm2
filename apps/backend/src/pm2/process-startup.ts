import { ObjectId } from "mongodb";
import { processInventory, processProjects, processStartup, projects } from "../common/database";
import { HttpError } from "../common/http-error";
import { withArtifactAccess } from "../common/artifact-access";
import { withManualProcessAction } from "../projects/build-progress";
import { withProjectConfiguration, withProjectOperation } from "../projects/project-operations";
import { projectPath } from "../projects/project-paths";
import { listProcesses, startSelectedProcess, validateStartupProcess } from "./pm2.service";
import { processScope } from "./process-projects";

async function selectedProcess(id: unknown, identity: Record<string, unknown>) {
  if (typeof id !== "string") throw new HttpError(400, "Processo inválido.");
  if (typeof identity.name !== "string" || typeof identity.namespace !== "string")
    throw new HttpError(400, "Informe o nome e o namespace do processo.");
  const row = (await listProcesses()).find(row => String(row.id) === id);
  if (!row) throw new HttpError(404, "Processo PM2 não encontrado.");
  if (row.name !== identity.name || row.namespace !== identity.namespace)
    throw new HttpError(409, "O processo mudou. Atualize a lista antes de salvar.");
  return row;
}

export async function getProcessSettings(id: unknown, identity: Record<string, unknown>) {
  const row = await selectedProcess(id, identity);
  const known = typeof row.id === "number" || Boolean(await processInventory.findOne({
    scope: processScope(), name: row.name, namespace: row.namespace,
  }));
  return { name: row.name, namespace: row.namespace, autoStart: row.autoStart || false,
    autoStartUpdatedAt: row.autoStartUpdatedAt, autoStartError: row.autoStartError,
    canAutoStart: Boolean(row.projectId && known), projectId: row.projectId };
}

export async function saveProcessSettings(id: unknown, body: Record<string, unknown> | undefined, username: string) {
  if (typeof body?.autoStart !== "boolean") throw new HttpError(400, "Informe se o início automático está habilitado.");
  return withManualProcessAction(() => withProjectConfiguration(async () => {
    const settings = await getProcessSettings(id, body);
    const filter = { scope: processScope(), name: settings.name, namespace: settings.namespace };
    const previous = await processStartup.findOne(filter);
    const updatedAt = new Date(Math.max(Date.now(), (previous?.updatedAt.getTime() || 0) + 1));
    if (!body.autoStart) {
      await processStartup.updateOne(filter, { $set: { enabled: false, updatedAt, updatedBy: username }, $unset: { error: "" } });
    } else {
      if (!settings.canAutoStart || !settings.projectId)
        throw new HttpError(400, "Vincule o processo a um projeto e inicie-o uma vez antes de habilitar o início automático.");
      const projectId = new ObjectId(settings.projectId);
      await withProjectOperation(projectId, async () => {
        const project = await projects.findOne({ _id: projectId });
        if (!project || project.deleting || project.deployment)
          throw new HttpError(409, "Aguarde a conclusão ou recuperação da operação no projeto.");
        const path = await projectPath(project.rootPath, project.pm2ConfigPath);
        await validateStartupProcess(path, project.rootPath, settings.name, settings.namespace);
        await processStartup.updateOne(filter, { $set: { projectId, enabled: true, updatedAt, updatedBy: username },
          $unset: { error: "" } }, { upsert: true });
      });
    }
    return { ...settings, autoStart: body.autoStart, autoStartUpdatedAt: updatedAt.toISOString(), autoStartError: "" };
  }));
}

// Run once at monitor startup, after interrupted publications have been recovered.
export async function startConfiguredProcesses() {
  for (const record of await processStartup.find({ scope: processScope(), enabled: true }).toArray()) {
    let error = "";
    try {
      await withManualProcessAction(() => withArtifactAccess(() => withProjectOperation(record.projectId, async () => {
        const project = await projects.findOne({ _id: record.projectId });
        const link = await processProjects.findOne({ scope: record.scope, name: record.name, namespace: record.namespace });
        if (!project || project.deleting || project.deployment || project.deploymentError || (link && !link.projectId?.equals(record.projectId)))
          throw new Error("Início automático suspenso: confira o projeto, seu vínculo e possíveis falhas de publicação.");
        const path = await projectPath(project.rootPath, project.pm2ConfigPath);
        await startSelectedProcess(path, project.rootPath, record.name, record.namespace);
      })));
    } catch (reason) {
      error = reason instanceof Error ? reason.message : "Falha no início automático.";
      console.error(`Início automático de ${record.name}: ${error}`);
    }
    await processStartup.updateOne({ _id: record._id }, { $set: { lastAttemptAt: new Date(), error } });
  }
}
