import { createHash, randomUUID } from "node:crypto";
import { lstat, open, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { HttpError } from "../common/http-error";
import { withArtifactAccess } from "../common/artifact-access";
import { getProject } from "./projects.service";
import { projectPath, relativeProjectPath } from "./project-paths";
import { withProjectOperation } from "./project-operations";
import { pm2Configuration } from "./pm2-configuration";

const maxBytes = 32 * 1024;
const environmentName = /^\.env(?:\.[a-zA-Z0-9_-][a-zA-Z0-9._-]*)?$/;
function fileName(raw: unknown, configPath: string) {
  const name = relativeProjectPath(raw);
  if (name === configPath) return name;
  if (!environmentName.test(name) || name.length > 128)
    throw new HttpError(400, "Use .env ou um nome como .env.production, na raiz do projeto.");
  return name;
}

async function readEnvironment(root: string, name: string) {
  const path = await projectPath(root, name, true);
  const info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!info) return { name, content: "", revision: null };
  if (!info.isFile() || info.size > maxBytes)
    throw new HttpError(400, "O arquivo de ambiente deve ser um texto de até 32 KB.");
  const file = await open(path, "r");
  try {
    const bytes = Buffer.alloc(maxBytes + 1);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    const data = bytes.subarray(0, bytesRead);
    if (bytesRead > maxBytes || data.includes(0))
      throw new HttpError(400, "O arquivo de ambiente deve ser um texto de até 32 KB.");
    let content: string;
    try { content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data); }
    catch { throw new HttpError(400, "O arquivo de ambiente deve usar UTF-8."); }
    return { name, content, revision: createHash("sha256").update(data).digest("hex") };
  } finally { await file.close(); }
}

export async function getEnvironmentFile(rawProject: unknown, rawName: unknown) {
  const project = await getProject(rawProject);
  const name = fileName(rawName, project.pm2ConfigPath);
  const file = await readEnvironment(project.rootPath, name);
  const entries = await readdir(await projectPath(project.rootPath, ""), { withFileTypes: true });
  const names = entries.filter(entry => entry.isFile() && environmentName.test(entry.name))
    .map(entry => entry.name).sort();
  return { ...file, names };
}

export async function saveEnvironmentFile(rawProject: unknown, rawName: unknown, body: Record<string, unknown> | undefined) {
  if (typeof body?.content !== "string" || Buffer.byteLength(body.content, "utf8") > maxBytes || body.content.includes("\0"))
    throw new HttpError(400, "O arquivo de ambiente deve ser um texto de até 32 KB.");
  if (body.revision !== null && (typeof body.revision !== "string" || !/^[a-f0-9]{64}$/.test(body.revision)))
    throw new HttpError(400, "Abra o arquivo de ambiente antes de salvar.");
  const content = body.content;
  return withArtifactAccess(async () => {
    const project = await getProject(rawProject);
    return withProjectOperation(project._id, async () => {
      const current = await getProject(rawProject);
      const name = fileName(rawName, current.pm2ConfigPath);
      if (name === current.pm2ConfigPath) pm2Configuration(content);
      if (current.deployment)
        throw new HttpError(409, "Aguarde a conclusão ou recuperação da publicação antes de salvar.");
      const file = await readEnvironment(current.rootPath, name);
      if (file.revision !== body.revision)
        throw new HttpError(409, "O arquivo foi alterado desde a abertura. Copie suas alterações e reabra o arquivo antes de salvar.");
      const destination = await projectPath(current.rootPath, name, true);
      const temporary = `${destination}.monitor-${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, content, { flag: "wx", mode: 0o600 });
        await projectPath(current.rootPath, name, true);
        await rename(temporary, destination);
      } finally {
        await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        });
      }
      return { name, content, revision: createHash("sha256").update(content, "utf8").digest("hex") };
    });
  });
}
