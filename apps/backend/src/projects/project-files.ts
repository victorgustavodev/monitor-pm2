import { lstat, open, opendir } from "node:fs/promises";
import { HttpError } from "../common/http-error";
import { projectPath, relativeProjectPath } from "./project-paths";

export async function browseProject(root: string, rawPath: unknown) {
  const path = relativeProjectPath(rawPath, true);
  const target = await projectPath(root, path);
  const info = await lstat(target);
  if (info.isDirectory()) {
    const entries = [];
    let truncated = false;
    const directory = await opendir(target);
    for await (const item of directory) {
      if (entries.length >= 2000) {
        truncated = true;
        break;
      }
      const child = path ? `${path}/${item.name}` : item.name;
      const stats = await lstat(`${target}/${item.name}`).catch(() => null);
      entries.push({
        name: item.name,
        path: child,
        type:
          item.isSymbolicLink() || (!item.isFile() && !item.isDirectory())
            ? "blocked"
            : item.isDirectory()
              ? "directory"
              : "file",
        size: stats?.size || 0,
        modifiedAt: stats?.mtime.toISOString() || null,
      });
    }
    entries.sort(
      (a, b) =>
        Number(b.type === "directory") - Number(a.type === "directory") ||
        a.name.localeCompare(b.name),
    );
    return { type: "directory", path, entries, truncated };
  }
  if (!info.isFile())
    throw new HttpError(400, "Esse tipo de arquivo não pode ser visualizado.");
  const limit = 256 * 1024;
  const file = await open(target, "r");
  try {
    const buffer = Buffer.alloc(Math.min(info.size, limit));
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    const data = buffer.subarray(0, bytesRead);
    const binary = data.includes(0);
    return {
      type: "file",
      path,
      size: info.size,
      modifiedAt: info.mtime.toISOString(),
      binary,
      truncated: info.size > limit,
      content: binary ? null : data.toString("utf8"),
    };
  } finally {
    await file.close();
  }
}
