import { parentPort, workerData } from "node:worker_threads";
import { mkdir, open, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { ArchiveReader, libarchiveWasm } from "libarchive-wasm";
import { archivePath } from "./archive-path";
import { archiveExtension, archiveSignatureMatches } from "./archive-format";

async function extract() {
  const { archive, target, maxBytes } = workerData as {
    archive: string;
    target: string;
    maxBytes: number;
  };
  const data = await readFile(archive);
  const extension = archiveExtension(archive);
  if (!extension || !archiveSignatureMatches(extension, data))
    throw new Error(
      "O conteúdo não corresponde ao formato do arquivo compactado.",
    );
  const reader = new ArchiveReader(
    await libarchiveWasm(),
    new Int8Array(data.buffer, data.byteOffset, data.byteLength),
  );
  const paths = new Set<string>();
  const types = new Map<string, string>();
  const ecosystems: string[] = [];
  let total = 0,
    count = 0,
    files = 0;
  try {
    for (const entry of reader.entries()) {
      if (++count > 50_000)
        throw new Error(
          "O arquivo compactado excede o limite de 50 mil entradas.",
        );
      if (entry.isEncrypted())
        throw new Error("Arquivos compactados com senha não são aceitos.");
      const type = entry.getFiletype();
      if (
        !["File", "Directory"].includes(type) ||
        entry.getSymlinkTarget() ||
        entry.getHardlinkTarget()
      ) {
        throw new Error("Links e arquivos especiais não são aceitos no build.");
      }
      const name = entry.getPathname();
      // TARs commonly include their root directory and a leading ./ on entries.
      if (type === "Directory" && (name === "." || /^(?:\.\/)+$/.test(name)))
        continue;
      const path = archivePath(name);
      const key = path.toLowerCase();
      if (paths.has(key))
        throw new Error("O arquivo compactado contém caminhos duplicados.");
      paths.add(key);
      if (types.has(key) && types.get(key) !== type)
        throw new Error("O arquivo compactado contém caminhos conflitantes.");
      types.set(key, type);
      const segments = key.split("/");
      for (let index = 1; index < segments.length; index++) {
        const parent = segments.slice(0, index).join("/");
        if (types.get(parent) === "File")
          throw new Error("O arquivo compactado contém caminhos conflitantes.");
        types.set(parent, "Directory");
      }
      const size = entry.getSize();
      if (!Number.isSafeInteger(size) || size < 0)
        throw new Error(
          "O arquivo compactado contém um tamanho de arquivo inválido.",
        );
      if (total + size > maxBytes)
        throw new Error("O build descompactado excede o limite configurado.");
      const destination = resolve(target, path);
      if (type === "Directory") {
        await mkdir(destination, { recursive: true });
        continue;
      }
      await mkdir(dirname(destination), { recursive: true });
      const file = await open(destination, "wx");
      let written = 0;
      try {
        // Read bounded chunks instead of allocating the declared size of an entry.
        for (;;) {
          const chunk = reader.readData(64 * 1024);
          if (!chunk.length) break;
          written += chunk.length;
          total += chunk.length;
          if (total > maxBytes)
            throw new Error(
              "O build descompactado excede o limite configurado.",
            );
          if (written > size)
            throw new Error(
              "O arquivo compactado contém um tamanho de arquivo inválido.",
            );
          await file.writeFile(chunk);
        }
      } finally {
        await file.close();
      }
      if (written !== size)
        throw new Error("O arquivo compactado está incompleto ou corrompido.");
      files++;
      if (path.split("/").pop() === "ecosystem.config.js")
        ecosystems.push(path);
    }
    if (reader.libarchive.error_string(reader.archive))
      throw new Error(
        "O arquivo compactado está incompleto, corrompido ou usa um método não suportado.",
      );
    if (reader.hasEncryptedData())
      throw new Error("Arquivos compactados com senha não são aceitos.");
    if (!files)
      throw new Error("O arquivo compactado não contém arquivos de build.");
    parentPort?.postMessage({
      ecosystem: ecosystems.length === 1 ? ecosystems[0] : undefined,
    });
  } finally {
    reader.free();
  }
}

extract().catch((error: unknown) => {
  parentPort?.postMessage({
    error:
      error instanceof Error ? error.message : "Arquivo compactado inválido.",
  });
});
