import { parentPort, workerData } from 'node:worker_threads';
import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { createExtractorFromFile } from 'node-unrar-js';
import { archivePath } from './archive-path';

async function extract() {
  const { archive, target, maxBytes } = workerData as { archive: string; target: string; maxBytes: number };
  const extractor = await createExtractorFromFile({ filepath: archive, targetPath: target, filenameTransform: archivePath });
  const listing = extractor.getFileList();
  const entries = [...listing.fileHeaders];
  if (listing.arcHeader.flags.volume || listing.arcHeader.flags.headerEncrypted || !entries.length) {
    throw new Error('Envie um RAR único, sem senha e com o build completo.');
  }
  const paths = new Set<string>();
  const ecosystems: string[] = [];
  let total = 0;
  if (entries.length > 50_000) throw new Error('O RAR excede o limite de 50 mil entradas.');
  for (const entry of entries) {
    const path = archivePath(entry.name);
    if (paths.has(path.toLowerCase())) throw new Error('O RAR contém caminhos duplicados.');
    paths.add(path.toLowerCase());
    if (entry.flags.encrypted) throw new Error('Arquivos RAR com senha não são aceitos.');
    if (!Number.isSafeInteger(entry.unpSize) || entry.unpSize < 0) throw new Error('O RAR contém um tamanho de arquivo inválido.');
    total += entry.unpSize;
    if (!Number.isSafeInteger(total) || total > maxBytes) throw new Error('O build descompactado excede o limite configurado.');
    if (!entry.flags.directory && path.split('/').pop() === 'ecosystem.config.js') ecosystems.push(path);
  }
  if (!entries.some((entry) => !entry.flags.directory)) throw new Error('O RAR não contém arquivos de build.');
  let written = 0;
  for (const file of extractor.extract().files) {
    if (!file.fileHeader.flags.directory) {
      const path = resolve(target, archivePath(file.fileHeader.name));
      const stat = statSync(path);
      if (!stat.isFile()) throw new Error('O RAR contém uma entrada que não é um arquivo normal.');
      written += stat.size;
      if (written > maxBytes) throw new Error('O build descompactado excede o limite configurado.');
    }
  }
  parentPort?.postMessage({ ecosystem: ecosystems.length === 1 ? ecosystems[0] : undefined });
}

extract().catch((error: unknown) => {
  parentPort?.postMessage({ error: error instanceof Error ? error.message : 'RAR inválido.' });
});
