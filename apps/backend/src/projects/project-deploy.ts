import type { BuildControl } from "./build-progress";
import {
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { HttpError } from "../common/http-error";
import {
  assertNoLinks,
  projectPath,
  relativeProjectPath,
} from "./project-paths";
import { env } from "../common/config";

type FileOperation = { path: string; existed: boolean; remove: boolean };
type DeploymentJournal = { rootPath: string; operations: FileOperation[] };

async function exists(path: string) {
  return lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
}

export async function scanBuild(root: string, signal?: AbortSignal) {
  const files: string[] = [];
  let bytes = 0,
    entries = 0;
  async function walk(path: string) {
    const directory = await projectPath(root, path);
    for (const item of await readdir(directory, { withFileTypes: true })) {
      signal?.throwIfAborted();
      if (++entries > 50_000)
        throw new HttpError(400, "O build excede o limite de 50 mil entradas.");
      const child = relativeProjectPath(
        path ? `${path}/${item.name}` : item.name,
      );
      if (item.isSymbolicLink())
        throw new HttpError(400, "O build contém um link não permitido.");
      if (item.isDirectory()) await walk(child);
      else if (item.isFile()) {
        const info = await lstat(await projectPath(root, child));
        bytes += info.size;
        if (bytes > env.extractedMaxBytes)
          throw new HttpError(
            400,
            "O build descompactado excede o limite configurado.",
          );
        files.push(child);
      } else
        throw new HttpError(
          400,
          "O build contém um arquivo especial não permitido.",
        );
    }
  }
  await walk("");
  return files;
}

async function atomicCopy(source: string, root: string, path: string) {
  await assertNoLinks(source);
  const destination = await projectPath(root, path, true);
  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.monitor-${randomUUID()}.tmp`;
  try {
    await copyFile(source, temporary);
    await rename(temporary, destination);
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

export async function prepareDeployment(
  root: string,
  source: string,
  files: string[],
  previousFiles: string[],
  attempt: string,
  control?: BuildControl,
) {
  await assertNoLinks(root);
  await assertNoLinks(attempt, true);
  const next = new Set(files);
  const paths = [...new Set([...files, ...previousFiles])];
  const operations: FileOperation[] = [];
  await mkdir(attempt, { recursive: true });
  for (const path of paths) {
    control?.signal.throwIfAborted();
    relativeProjectPath(path);
    const target = await projectPath(root, path, true);
    const info = await exists(target);
    if (info && !info.isFile())
      throw new HttpError(
        400,
        `O destino ${path} não é um arquivo comum. Ajuste a estrutura do pacote ou da pasta do projeto.`,
      );
    if (info) {
      const backup = resolve(attempt, "backup", path);
      await mkdir(dirname(backup), { recursive: true });
      await copyFile(target, backup);
    }
    operations.push({ path, existed: Boolean(info), remove: !next.has(path) });
  }
  const journal: DeploymentJournal = { rootPath: root, operations };
  await writeFile(resolve(attempt, "journal.json"), JSON.stringify(journal), {
    flag: "wx",
  });
  return async () => {
    let done = 0;
    for (const operation of operations) {
      control?.signal.throwIfAborted();
      if (operation.remove) {
        const target = await projectPath(root, operation.path, true);
        await unlink(target).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        });
      } else {
        await atomicCopy(
          await projectPath(source, operation.path),
          root,
          operation.path,
        );
      }
      done++;
      control?.report(60 + Math.floor(24 * done / operations.length), "Atualizando arquivos do projeto");
    }
  };
}

export async function restoreDeployment(root: string, attempt: string) {
  await assertNoLinks(attempt);
  const journal = JSON.parse(
    await readFile(resolve(attempt, "journal.json"), "utf8"),
  ) as DeploymentJournal;
  if (
    journal.rootPath !== root ||
    !Array.isArray(journal.operations) ||
    journal.operations.length > 100_000
  ) {
    throw new Error("Registro de recuperação de arquivos inválido.");
  }
  for (const operation of journal.operations.slice().reverse()) {
    const path = relativeProjectPath(operation.path);
    if (operation.existed)
      await atomicCopy(resolve(attempt, "backup", path), root, path);
    else {
      const target = await projectPath(root, path, true);
      await unlink(target).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
  }
}
