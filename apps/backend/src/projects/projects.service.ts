import { mkdir, rm } from "node:fs/promises";
import { resolve, basename } from "node:path";
import { MongoServerError, ObjectId, type WithId } from "mongodb";
import {
  projects,
  projectBuilds,
  type ProjectRecord,
} from "../common/database";
import { HttpError } from "../common/http-error";
import {
  containsPath,
  relativeProjectPath,
  validateProjectRoot,
  assertNoLinks,
} from "./project-paths";
import { withArtifactAccess } from "../common/artifact-access";
import { env } from "../common/config";
import {
  processArtifactPaths,
  getProjectProcesses,
  stopProjectProcesses,
} from "../pm2/pm2.service";
import { projectFolder } from "./project-storage";
import {
  withProjectConfiguration,
  withProjectOperation,
} from "./project-operations";
import { pm2Configuration } from "./pm2-configuration";

export function projectId(raw: unknown) {
  if (typeof raw !== "string" || !/^[a-f0-9]{24}$/i.test(raw))
    throw new HttpError(400, "ID de projeto ou build inválido.");
  return new ObjectId(raw);
}

export async function getProject(raw: unknown) {
  const project = await projects.findOne({ _id: projectId(raw) });
  if (!project) throw new HttpError(404, "Projeto não encontrado.");
  if (project.deleting)
    throw new HttpError(
      409,
      "A exclusão deste projeto está pendente. Tente excluir novamente.",
    );
  return project;
}

export function publicProject(project: WithId<ProjectRecord>, buildCount = 0) {
  const {
    nameKey: _nameKey,
    rootKey: _rootKey,
    deployment,
    ...record
  } = project;
  return {
    ...record,
    buildCount,
    deploying: Boolean(deployment || project.deleting),
    pathToRunPm2: resolve(project.rootPath, project.pm2ConfigPath),
  };
}

export async function listProjects() {
  const rows = await projects.find({}).sort({ nameKey: 1 }).toArray();
  const counts = await projectBuilds
    .aggregate<{
      _id: ObjectId;
      total: number;
    }>([{ $group: { _id: "$projectId", total: { $sum: 1 } } }])
    .toArray();
  const totals = new Map(
    counts.map((item) => [item._id.toHexString(), item.total]),
  );
  return rows.map((project) =>
    publicProject(project, totals.get(project._id.toHexString()) || 0),
  );
}

async function projectFields(
  body: Record<string, unknown> | undefined,
  excludeId?: ObjectId,
  previousConfig = "",
) {
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const description =
    typeof body?.description === "string" ? body.description.trim() : "";
  if (!name || name.length > 80 || /[\x00-\x1f]/.test(name))
    throw new HttpError(
      400,
      "Informe um nome de projeto com até 80 caracteres.",
    );
  if (description.length > 500)
    throw new HttpError(400, "A descrição deve ter até 500 caracteres.");
  const rootPath = await validateProjectRoot(body?.rootPath);
  const pm2ConfigPath = relativeProjectPath(
    body?.pm2ConfigPath || "ecosystem.config.js",
  );
  const pm2ConfigContent = pm2Configuration(
    body?.pm2ConfigContent,
    previousConfig,
  );
  if (basename(pm2ConfigPath).toLowerCase() !== "ecosystem.config.js")
    throw new HttpError(
      400,
      "Informe o caminho relativo do ecosystem.config.js dentro do projeto.",
    );
  const existing = await projects
    .find(excludeId ? { _id: { $ne: excludeId } } : {}, {
      projection: { rootPath: 1, nameKey: 1 },
    })
    .toArray();
  if (existing.some((project) => project.nameKey === name.toLowerCase()))
    throw new HttpError(409, "Já existe um projeto com esse nome.");
  if (
    existing.some(
      (project) =>
        containsPath(project.rootPath, rootPath) ||
        containsPath(rootPath, project.rootPath),
    )
  )
    throw new HttpError(
      409,
      "Essa pasta já pertence a outro projeto ou se sobrepõe à pasta dele.",
    );
  return {
    name,
    nameKey: name.toLowerCase(),
    description,
    rootPath,
    rootKey: rootPath.toLowerCase(),
    pm2ConfigPath,
    pm2ConfigContent,
  };
}

async function configuration<T>(action: () => Promise<T>) {
  return withArtifactAccess(() =>
    withProjectConfiguration(async () => {
      try {
        return await action();
      } catch (error) {
        if (error instanceof MongoServerError && error.code === 11000)
          throw new HttpError(
            409,
            "Já existe um projeto com esse nome ou pasta.",
          );
        throw error;
      }
    }),
  );
}

function assertEditable(project: WithId<ProjectRecord>) {
  if (project.deployment)
    throw new HttpError(
      409,
      "O projeto tem uma publicação pendente de recuperação. Conclua a recuperação antes de alterar ou excluir.",
    );
}

export async function createProject(
  body: Record<string, unknown> | undefined,
  username: string,
) {
  return configuration(async () => {
    const fields = await projectFields(body);
    const now = new Date();
    const record: ProjectRecord = {
      ...fields,
      createdAt: now,
      updatedAt: now,
      createdBy: username,
      nextBuildNumber: 0,
    };
    await mkdir(fields.rootPath, { recursive: true });
    const result = await projects.insertOne(record);
    return publicProject({ ...record, _id: result.insertedId });
  });
}

export async function updateProject(
  rawId: unknown,
  body: Record<string, unknown> | undefined,
  username: string,
) {
  const id = projectId(rawId);
  return configuration(() =>
    withProjectOperation(id, async () => {
      const current = await getProject(rawId);
      assertEditable(current);
      const fields = await projectFields(
        body,
        id,
        current.pm2ConfigContent || "",
      );
      const rootChanged = current.rootKey !== fields.rootKey;
      await mkdir(fields.rootPath, { recursive: true });
      await projects.updateOne(
        { _id: id },
        {
          $set: { ...fields, updatedAt: new Date(), updatedBy: username },
          ...(rootChanged
            ? { $unset: { activeBuildId: "", deploymentError: "" } }
            : {}),
        },
      );
      return publicProject(
        await getProject(rawId),
        await projectBuilds.countDocuments({ projectId: id }),
      );
    }),
  );
}

export async function projectDeletionPreview(rawId: unknown) {
  const project = await projects.findOne({ _id: projectId(rawId) });
  if (!project) throw new HttpError(404, "Projeto não encontrado.");
  assertEditable(project);
  return getProjectProcesses(project.rootPath);
}

export async function deleteProject(
  rawId: unknown,
  options?: Record<string, unknown>,
) {
  if (
    options?.stopProcesses !== undefined &&
    typeof options.stopProcesses !== "boolean"
  )
    throw new HttpError(400, "Opção de encerramento dos processos inválida.");
  if (
    options?.stopProcesses === true &&
    typeof options.processRevision !== "string"
  )
    throw new HttpError(
      400,
      "Confira os processos vinculados antes de confirmar a exclusão.",
    );
  const id = projectId(rawId);
  return withArtifactAccess(() =>
    withProjectOperation(id, async () => {
      // Include a tombstone so an interrupted deletion can be retried.
      const project = await projects.findOne({ _id: id });
      if (!project) throw new HttpError(404, "Projeto não encontrado.");
      assertEditable(project);
      const folder = projectFolder(id);
      if (
        !containsPath(env.versionsPath, folder) ||
        resolve(env.versionsPath) === folder
      )
        throw new HttpError(400, "Destino de exclusão inválido.");
      await assertNoLinks(folder, true);
      if (await projectBuilds.countDocuments({ projectId: id })) {
        let paths: string[];
        try {
          paths = await processArtifactPaths();
        } catch {
          throw new HttpError(
            502,
            "Não foi possível verificar os arquivos usados pelo PM2. Tente excluir novamente quando o PM2 estiver disponível.",
          );
        }
        if (paths.some((path) => containsPath(folder, path)))
          throw new HttpError(
            409,
            "Um processo do PM2 usa arquivos armazenados deste projeto. Remova essa referência antes de excluir.",
          );
      }
      if (options?.stopProcesses === true)
        await stopProjectProcesses(
          project.rootPath,
          options.processRevision as string,
        );
      await projects.updateOne({ _id: id }, { $set: { deleting: true } });
      await rm(folder, { recursive: true, force: true });
      await projectBuilds.deleteMany({ projectId: id });
      await projects.deleteOne({ _id: id });
    }),
  );
}
