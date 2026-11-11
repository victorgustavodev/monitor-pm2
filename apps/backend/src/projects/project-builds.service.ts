import type { BuildControl } from "./build-progress";
import { createReadStream } from "node:fs";
import { withArtifactAccess } from "../common/artifact-access";
import { withProjectOperation as exclusive } from "./project-operations";

export const createProjectBuild = async (
  ...args: Parameters<typeof createProjectBuildInternal>
) => {
  try {
    return await withArtifactAccess(() => createProjectBuildInternal(...args));
  } finally {
    if (args[1]) await rm(args[1].path, { force: true });
  }
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
import { dirname, resolve } from "node:path";
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

async function previousBuildFiles(
  project: WithId<ProjectRecord>,
  control?: BuildControl,
): Promise<string[]> {
  if (!project.activeBuildId) return [];
  const manifest = await projectPath(
    projectBuildFolder(project._id, project.activeBuildId),
    "manifest.json",
    true,
  );
  let content: string;
  try {
    content = await readFile(manifest, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      // Without the manifest, neither the source nor the live folder proves
      // which files were installed. Preserve unknown files instead of deleting them.
      control?.report(35, "Manifesto do build ativo ausente. Arquivos antigos fora do novo pacote serão preservados.");
      return [];
    }
    throw new HttpError(409, "Não foi possível ler o manifesto do build ativo. Verifique o acesso ao armazenamento de versões.");
  }
  try {
    const files: unknown = JSON.parse(content);
    if (!Array.isArray(files) || files.length > 50_000)
      throw new Error("Invalid manifest");
    return files.map((path: unknown) => relativeProjectPath(path));
  } catch {
    throw new HttpError(409, "O manifesto do build ativo está inválido. Restaure o manifesto a partir de uma cópia de segurança antes de publicar.");
  }
}

async function deploy(
  project: WithId<ProjectRecord>,
  build: WithId<ProjectBuildRecord>,
  username: string,
  control?: BuildControl,
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
  control?.report(35, "Validando arquivos");
  const liveConfig = await projectPath(project.rootPath, project.pm2ConfigPath, true);
  const liveInfo = await lstat(liveConfig).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (liveInfo && !liveInfo.isFile())
    throw new HttpError(400, "O caminho da configuração PM2 deve ser um arquivo comum.");
  const preserveConfig = Boolean(liveInfo);
  const isConfig = (path: string) => process.platform === "win32"
    ? path.toLowerCase() === project.pm2ConfigPath.toLowerCase()
    : path === project.pm2ConfigPath;
  let files = await scanBuild(source, control?.signal);
  if (preserveConfig) files = files.filter((path) => !isConfig(path));
  let configInBuild = files.some(isConfig);
  if (!preserveConfig && !configInBuild && project.pm2ConfigContent) {
    // Retain an initialization snapshot for destinations without a config.
    const config = await projectPath(source, project.pm2ConfigPath, true);
    await mkdir(dirname(config), { recursive: true });
    await writeFile(config, project.pm2ConfigContent, { flag: "wx" });
    files = await scanBuild(source, control?.signal);
    configInBuild = true;
  }
  if (!preserveConfig && !configInBuild) {
    throw new HttpError(
      400,
      `Configuração PM2 não encontrada. Salve a configuração na aba Variáveis de ambiente ou inclua ${project.pm2ConfigPath} no pacote ou na pasta do projeto.`,
    );
  }
  let previousFiles = await previousBuildFiles(project, control);
  // Once installed, the local configuration is managed independently of builds.
  if (preserveConfig || !configInBuild)
    previousFiles = previousFiles.filter((path) => !isConfig(path));
  const attemptId = randomUUID();
  const attempt = deploymentFolder(project._id, build._id, attemptId);
  control?.report(45, "Preparando cópia de segurança");
  const apply = await prepareDeployment(
    project.rootPath,
    source,
    files,
    previousFiles,
    attempt,
    control,
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
    control?.report(60, "Atualizando arquivos do projeto");
    await apply();
    control?.report(85, "Recriando aplicações no PM2 e verificando a inicialização", false);
    await deployEcosystem(
      await projectPath(project.rootPath, project.pm2ConfigPath),
    );
    control?.report(95, "Finalizando publicação", false);
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
  control?: BuildControl,
) {
  if (!file)
    throw new HttpError(400, "Selecione o arquivo compactado do build.");
  try {
    return await exclusive(project._id, async () => {
      control?.report(10, "Validando pacote recebido");
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
      for await (const chunk of createReadStream(file.path)) { control?.signal.throwIfAborted(); hash.update(chunk); }
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
        control?.report(20, "Extraindo arquivos do pacote");
        const extracted = await extractBuild(archive, source, control?.signal);
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
          control,
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
    }, control?.operationId);
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
  control?: BuildControl,
) {
  const project = await getProject(rawProject);
  return exclusive(project._id, async () =>
    deploy(
      await getProject(rawProject),
      await getProjectBuild(project._id, rawBuild),
      username,
      control,
    ), control?.operationId,
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
