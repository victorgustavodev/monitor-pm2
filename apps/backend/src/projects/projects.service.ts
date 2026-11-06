import { mkdir } from "node:fs/promises";
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
} from "./project-paths";

export function projectId(raw: unknown) {
  if (typeof raw !== "string" || !/^[a-f0-9]{24}$/i.test(raw))
    throw new HttpError(400, "ID de projeto ou build inválido.");
  return new ObjectId(raw);
}

export async function getProject(raw: unknown) {
  const project = await projects.findOne({ _id: projectId(raw) });
  if (!project) throw new HttpError(404, "Projeto não encontrado.");
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
    deploying: Boolean(deployment),
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

let creating = false;
export async function createProject(
  body: Record<string, unknown> | undefined,
  username: string,
) {
  if (creating)
    throw new HttpError(
      409,
      "Aguarde a conclusão do outro cadastro de projeto.",
    );
  creating = true;
  try {
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
    if (basename(pm2ConfigPath).toLowerCase() !== "ecosystem.config.js") {
      throw new HttpError(
        400,
        "Informe o caminho relativo do ecosystem.config.js dentro do projeto.",
      );
    }
    const existing = await projects
      .find({}, { projection: { rootPath: 1, nameKey: 1 } })
      .toArray();
    if (existing.some((project) => project.nameKey === name.toLowerCase()))
      throw new HttpError(409, "Já existe um projeto com esse nome.");
    if (
      existing.some(
        (project) =>
          containsPath(project.rootPath, rootPath) ||
          containsPath(rootPath, project.rootPath),
      )
    ) {
      throw new HttpError(
        409,
        "Essa pasta já pertence a outro projeto ou se sobrepõe à pasta dele.",
      );
    }
    const now = new Date();
    const record: ProjectRecord = {
      name,
      nameKey: name.toLowerCase(),
      description,
      rootPath,
      rootKey: rootPath.toLowerCase(),
      pm2ConfigPath,
      createdAt: now,
      updatedAt: now,
      createdBy: username,
      nextBuildNumber: 0,
    };
    await mkdir(rootPath, { recursive: true });
    const result = await projects.insertOne(record);
    return publicProject({ ...record, _id: result.insertedId });
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000)
      throw new HttpError(409, "Já existe um projeto com esse nome ou pasta.");
    throw error;
  } finally {
    creating = false;
  }
}
