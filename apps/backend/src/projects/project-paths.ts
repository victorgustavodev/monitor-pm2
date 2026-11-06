import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, parse, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { env, projectRoot } from "../common/config";
import { HttpError } from "../common/http-error";
import { archivePath } from "../versions/archive-path";

export function containsPath(parent: string, child: string) {
  const path = relative(parent.toLowerCase(), child.toLowerCase());
  return (
    path === "" ||
    (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`))
  );
}

export function relativeProjectPath(raw: unknown, allowRoot = false): string {
  if (allowRoot && (raw === undefined || raw === "")) return "";
  if (typeof raw !== "string" || raw.length > 2048)
    throw new HttpError(400, "Caminho de arquivo inválido.");
  return archivePath(raw);
}

// Inspect every existing component: junctions and symlinks cannot escape the project.
export async function assertNoLinks(path: string, allowMissing = false) {
  const root = parse(path).root;
  let current = root;
  for (const part of relative(root, path).split(sep).filter(Boolean)) {
    current = resolve(current, part);
    const info = await lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (allowMissing && error.code === "ENOENT") return null;
      if (error.code === "ENOENT")
        throw new HttpError(404, "Arquivo ou pasta não encontrado.");
      throw new HttpError(
        400,
        "Não foi possível acessar a pasta. Verifique as permissões na VM.",
      );
    });
    if (!info) return;
    if (info.isSymbolicLink())
      throw new HttpError(
        400,
        "Links e junções não podem ser acessados pelo projeto.",
      );
  }
}

export async function projectPath(
  root: string,
  path: string,
  allowMissing = false,
) {
  const target = resolve(root, path);
  if (!containsPath(root, target))
    throw new HttpError(400, "O caminho está fora da pasta do projeto.");
  await assertNoLinks(target, allowMissing);
  return target;
}

export async function validateProjectRoot(raw: unknown) {
  if (
    typeof raw !== "string" ||
    !raw.trim() ||
    raw.length > 1024 ||
    !isAbsolute(raw.trim())
  ) {
    throw new HttpError(
      400,
      "Informe o caminho absoluto de uma pasta dedicada ao projeto na VM.",
    );
  }
  const root = resolve(raw.trim());
  if (
    root === parse(root).root ||
    root.toLowerCase() === homedir().toLowerCase()
  ) {
    throw new HttpError(
      400,
      "Use uma pasta dedicada ao projeto, abaixo da raiz do disco ou da pasta do usuário.",
    );
  }
  archivePath(relative(parse(root).root, root));
  const protectedPaths = [
    projectRoot,
    env.versionsPath,
    env.pm2Home || resolve(homedir(), ".pm2"),
    process.env.SystemRoot,
    process.env.ProgramFiles,
    process.env["ProgramFiles(x86)"],
  ].filter((value): value is string => Boolean(value));
  if (
    protectedPaths.some(
      (path) => containsPath(path, root) || containsPath(root, path),
    )
  ) {
    throw new HttpError(
      400,
      "A pasta do projeto não pode conter nem ficar dentro das pastas do monitor, de versões, do PM2 ou do sistema.",
    );
  }
  await assertNoLinks(root, true);
  const info = await lstat(root).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (info && !info.isDirectory())
    throw new HttpError(400, "O caminho do projeto deve ser uma pasta.");
  return info ? realpath(root) : root;
}
