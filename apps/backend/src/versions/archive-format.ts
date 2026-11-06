export const archiveExtensions = [
  ".tar.gz",
  ".tar.bz2",
  ".tar.xz",
  ".zip",
  ".rar",
  ".7z",
  ".tar",
  ".tgz",
  ".tbz2",
  ".tbz",
  ".txz",
] as const;

export type ArchiveExtension = (typeof archiveExtensions)[number];

export function archiveExtension(name: string): ArchiveExtension | undefined {
  const lower = name.toLowerCase();
  return archiveExtensions.find((extension) => lower.endsWith(extension));
}

export function archiveSignatureMatches(
  extension: ArchiveExtension,
  data: Uint8Array,
): boolean {
  const signatures: Record<string, string[]> = {
    ".zip": ["504b0304", "504b0506"],
    ".rar": ["526172211a0700", "526172211a070100"],
    ".7z": ["377abcaf271c"],
    ".tar.gz": ["1f8b"],
    ".tgz": ["1f8b"],
    ".tar.bz2": ["425a68"],
    ".tbz2": ["425a68"],
    ".tbz": ["425a68"],
    ".tar.xz": ["fd377a585a00"],
    ".txz": ["fd377a585a00"],
  };
  const prefix = Buffer.from(data.subarray(0, 8)).toString("hex");
  return (
    !signatures[extension] ||
    signatures[extension].some((signature) => prefix.startsWith(signature))
  );
}
