import { createReadStream } from "node:fs";
import { withArtifactAccess } from "../common/artifact-access";

export const createProjectBuild = async (
  ...args: Parameters<typeof createProjectBuildInternal>
) => {
  try { return await withArtifactAccess(() => createProjectBuildInternal(...args)); }
  finally { if (args[1]) await rm(args[1].path, { force: true }); }
};
export const deployProjectBuild = (
  ...args: Parameters<typeof deployProjectBuildInternal>
) => withArtifactAccess(() => deployProjectBuildInternal(...args));
import {
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { MongoServerError, ObjectId, type WithId } from "mongodb";
import {
  projectBuilds,
  projects,
  type ProjectBuildRecord,
  type ProjectRecord,
} from "../common/database";
import { HttpError } from "../common/http-error";
import { archiveExtension } from "../versions/archive-format";
import {
  createArchiveUpload,
  extractBuild,
} from "../versions/versions.service";
import { deployEcosystem } from "../pm2/pm2.service";
import { getProject, projectId } from "./projects.service";
import { projectPath, relativeProjectPath } from "./project-paths";
import { deploymentFolder, projectBuildFolder } from "./project-storage";
import {
  prepareDeployment,
  restoreDeployment,
  scanBuild,
} from "./project-deploy";

export const uploadProjectBuild = createArchiveUpload(16 * 1024);
const busyProjects = new Set<string>();

async function exclusive<T>(id: ObjectId, action: () => Promise<T>) {
  const key = id.toHexString();
  if (busyProjects.has(key))
    throw new HttpError(
      409,
      "Já existe um build em andamento neste projeto. Aguarde a conclusão.",
    );
  busyProjects.add(key);
  try {
    return await action();
  } finally {
    busyProjects.delete(key);
  }
}

export async function getProjectBuild(project: ObjectId, raw: unknown) {
  const build = await projectBuilds.findOne({
    _id: projectId(raw),
    projectId: project,
  });
  if (!build) throw new HttpError(404, "Build não encontrado neste projeto.");
  return build;
}

export async function listProjectBuilds(rawProject: unknown, rawPage: unknown) {
  const page = Number(rawPage ?? 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000)
    throw new HttpError(400, "Página de builds inválida.");
  const filter = rawProject ? { projectId: projectId(rawProject) } : {};
  const pageSize = 20;
  const [items, total] = await Promise.all([
    projectBuilds
      .find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .toArray(),
    projectBuilds.countDocuments(filter),
  ]);
  const records = await projects
    .find({ _id: { $in: items.map((item) => item.projectId) } })
    .toArray();
  const names = new Map(
    records.map((project) => [project._id.toHexString(), project]),
  );
  return {
    items: items.map(({ nameKey: _nameKey, ...item }) => ({
      ...item,
      projectName: names.get(item.projectId.toHexString())?.name || "Projeto",
      active:
        names
          .get(item.projectId.toHexString())
          ?.activeBuildId?.equals(item._id) || false,
    })),
    total,
    page,
    pageSize,
  };
}

async function deploy(
  project: WithId<ProjectRecord>,
  build: WithId<ProjectBuildRecord>,
  username: string,
) {
  if (project.deployment)
    throw new HttpError(
      409,
      "Há uma publicação pendente de recuperação neste projeto. Reinicie o monitor após corrigir o acesso à pasta.",
    );
  if (
    !build.extracted ||
    !["ready", "deployed", "failed"].includes(build.status)
  )
    throw new HttpError(400, "Esse build não está disponível para publicação.");
  const folder = projectBuildFolder(project._id, build._id);
  const source = await projectPath(
    resolve(folder, "source"),
    build.sourceRoot || "",
  );
  const files = await scanBuild(source);
  const configInBuild = files.includes(project.pm2ConfigPath);
  if (!configInBuild) {
    const config = await projectPath(
      project.rootPath,
      project.pm2ConfigPath,
      true,
    );
    if (!(await lstat(config).catch(() => null))?.isFile())
      throw new HttpError(
        400,
        `Inclua ${project.pm2ConfigPath} no pacote ou na pasta do projeto.`,
      );
  }
  let previousFiles: string[] = [];
  if (project.activeBuildId) {
    previousFiles = JSON.parse(
      await readFile(
        resolve(
          projectBuildFolder(project._id, project.activeBuildId),
          "manifest.json",
        ),
        "utf8",
      ),
    ) as string[];
    // An existing PM2 configuration may be intentionally managed outside a new package.
    if (!configInBuild)
      previousFiles = previousFiles.filter(
        (path) => path !== project.pm2ConfigPath,
      );
  }
  const attemptId = randomUUID();
  const attempt = deploymentFolder(project._id, build._id, attemptId);
  const apply = await prepareDeployment(
    project.rootPath,
    source,
    files,
    previousFiles,
    attempt,
  );
  await projects.updateOne(
    { _id: project._id },
    {
      $set: { deployment: { buildId: build._id, attemptId } },
      $unset: { deploymentError: "" },
    },
  );
  await projectBuilds.updateOne(
    { _id: build._id },
    { $set: { status: "deploying" }, $unset: { error: "" } },
  );
  try {
    await apply();
    await deployEcosystem(
      await projectPath(project.rootPath, project.pm2ConfigPath),
    );
    await writeFile(resolve(folder, "manifest.json"), JSON.stringify(files));
    const deployedAt = new Date();
    await projectBuilds.updateOne(
      { _id: build._id },
      {
        $set: {
          status: "deployed",
          deployedAt,
          deployedBy: username,
          fileCount: files.length,
        },
        $unset: { error: "" },
      },
    );
    await projects.updateOne(
      { _id: project._id },
      {
        $set: { activeBuildId: build._id, updatedAt: deployedAt },
        $unset: { deployment: "", deploymentError: "" },
      },
    );
  } catch (error) {
    let detail =
      error instanceof Error ? error.message : "Falha ao publicar o build.";
    try {
      await restoreDeployment(project.rootPath, attempt);
      detail +=
        " Os arquivos anteriores foram restaurados. Confira os processos no PM2.";
      await projects.updateOne(
        { _id: project._id },
        { $unset: { deployment: "" }, $set: { deploymentError: detail } },
      );
    } catch (restoreError) {
      detail += ` A recuperação dos arquivos ficou pendente: ${restoreError instanceof Error ? restoreError.message : "verifique as permissões da pasta"}.`;
      await projects.updateOne(
        { _id: project._id },
        { $set: { deploymentError: detail } },
      );
    }
    await projectBuilds.updateOne(
      { _id: build._id },
      { $set: { status: "failed", error: detail } },
    );
    throw new HttpError(502, detail);
  }
  return getProjectBuild(project._id, build._id.toHexString());
}

async function createProjectBuildInternal(
  project: WithId<ProjectRecord>,
  file: Express.Multer.File | undefined,
  body: Record<string, unknown> | undefined,
  username: string,
) {
  if (!file)
    throw new HttpError(400, "Selecione o arquivo compactado do build.");
  try {
    return await exclusive(project._id, async () => {
      const current = await getProject(project._id.toHexString());
      if (current.deployment)
        throw new HttpError(
          409,
          "O projeto tem uma publicação pendente de recuperação.",
        );
      const name = typeof body?.name === "string" ? body.name.trim() : "";
      const comments =
        typeof body?.comments === "string" ? body.comments.trim() : "";
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(name))
        throw new HttpError(
          400,
          "Informe um nome de build com até 80 caracteres: letras, números, ponto, hífen ou sublinhado.",
        );
      if (!comments || comments.length > 4000)
        throw new HttpError(
          400,
          "Descreva o que mudou neste build em um comentário de até 4000 caracteres.",
        );
      const extension = archiveExtension(file.originalname);
      if (!extension)
        throw new HttpError(
          400,
          "Formato de arquivo compactado não suportado.",
        );
      if (
        await projectBuilds.findOne({
          projectId: project._id,
          nameKey: name.toLowerCase(),
        })
      )
        throw new HttpError(
          409,
          "Já existe um build com esse nome neste projeto.",
        );
      const counter = await projects.findOneAndUpdate(
        { _id: project._id },
        { $inc: { nextBuildNumber: 1 } },
        { returnDocument: "after" },
      );
      if (!counter) throw new HttpError(404, "Projeto não encontrado.");
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(file.path)) hash.update(chunk);
      const record: ProjectBuildRecord = {
        projectId: project._id,
        name,
        nameKey: name.toLowerCase(),
        number: counter.nextBuildNumber,
        comments,
        createdBy: username,
        createdAt: new Date(),
        originalName: file.originalname,
        size: file.size,
        sha256: hash.digest("hex"),
        status: "processing",
        archiveReady: false,
        extracted: false,
      };
      const { insertedId } = await projectBuilds.insertOne(record);
      const folder = projectBuildFolder(project._id, insertedId);
      try {
        await mkdir(folder, { recursive: true });
        const archive = resolve(folder, `build${extension}`);
        await rename(file.path, archive);
        await projectBuilds.updateOne(
          { _id: insertedId },
          { $set: { archiveReady: true } },
        );
        const source = resolve(folder, "source");
        const extracted = await extractBuild(archive, source);
        let sourceRoot = "";
        // Strip a packaging folder only when the configured ecosystem identifies it.
        if (extracted.ecosystem?.endsWith(`/${project.pm2ConfigPath}`)) {
          sourceRoot = relativeProjectPath(
            extracted.ecosystem.slice(0, -project.pm2ConfigPath.length - 1),
          );
        }
        await projectBuilds.updateOne(
          { _id: insertedId },
          { $set: { status: "ready", extracted: true, sourceRoot } },
        );
        return await deploy(
          current,
          await getProjectBuild(project._id, insertedId.toHexString()),
          username,
        );
      } catch (error) {
        await projectBuilds.updateOne(
          { _id: insertedId },
          {
            $set: {
              status: "failed",
              error:
                error instanceof Error
                  ? error.message
                  : "Falha ao criar o build.",
            },
          },
        );
        throw error;
      }
    });
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000)
      throw new HttpError(
        409,
        "Já existe um build com esse nome neste projeto.",
      );
    throw error;
  } finally {
    await rm(file.path, { force: true });
  }
}

async function deployProjectBuildInternal(
  rawProject: unknown,
  rawBuild: unknown,
  username: string,
) {
  const project = await getProject(rawProject);
  return exclusive(project._id, async () =>
    deploy(
      await getProject(rawProject),
      await getProjectBuild(project._id, rawBuild),
      username,
    ),
  );
}

export async function recoverProjectBuilds() {
  for (const project of await projects
    .find({ deployment: { $exists: true } })
    .toArray()) {
    if (!project.deployment) continue;
    let error =
      "Publicação interrompida. Arquivos anteriores restaurados; confira os processos no PM2 antes de publicar novamente.";
    try {
      await restoreDeployment(
        project.rootPath,
        deploymentFolder(
          project._id,
          project.deployment.buildId,
          project.deployment.attemptId,
        ),
      );
      await projects.updateOne(
        { _id: project._id },
        { $unset: { deployment: "" }, $set: { deploymentError: error } },
      );
    } catch (reason) {
      error = `Recuperação de arquivos pendente: ${reason instanceof Error ? reason.message : "verifique a pasta do projeto"}.`;
      await projects.updateOne(
        { _id: project._id },
        { $set: { deploymentError: error } },
      );
    }
    await projectBuilds.updateOne(
      { _id: project.deployment.buildId },
      { $set: { status: "failed", error } },
    );
  }
  await projectBuilds.updateMany(
    { status: { $in: ["processing", "deploying"] } },
    {
      $set: {
        status: "failed",
        error:
          "Operação interrompida pelo reinício do monitor. Confira os arquivos e o PM2.",
      },
    },
  );
}
