import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { logCursors, logs } from "../common/database";
import { processLogSources } from "../pm2/pm2.service";
import type { LiveLog } from "./log-stream";

export async function collectProcessLogs(publish?: (row: LiveLog) => void) {
  const sources = await processLogSources();
  const seen = new Set<string>();
  for (const source of sources) {
    if (seen.has(source.path)) continue;
    seen.add(source.path);
    const file = await open(source.path, "r").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!file) continue;
    try {
      const stat = await file.stat();
      const identity = `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
      const id = createHash("sha256").update(source.path).digest("hex");
      const cursor = await logCursors.findOne({ _id: id });
      let offset =
        cursor?.identity === identity && cursor.offset <= stat.size
          ? cursor.offset
          : Math.max(0, stat.size - 64 * 1024);
      // Limita o trabalho de cada coleta; o restante segue no próximo ciclo.
      const buffer = Buffer.alloc(Math.min(256 * 1024, stat.size - offset));
      if (buffer.length) {
        const { bytesRead } = await file.read(buffer, 0, buffer.length, offset);
        let end = bytesRead;
        // Mantém caracteres UTF-8 incompletos para a próxima leitura.
        while (
          end > 0 &&
          end >= bytesRead - 3 &&
          (buffer[end - 1] & 0xc0) === 0x80
        )
          end--;
        if (end > 0) {
          const byte = buffer[end - 1];
          const length =
            byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc0 ? 2 : 1;
          end = bytesRead - end + 1 < length ? end - 1 : bytesRead;
        }
        if (end > 0) {
          const row = {
            kind: "process" as const,
            createdAt: new Date(),
            processId: source.id,
            processName: source.name,
            namespace: source.namespace,
            source: source.path,
            content: buffer.subarray(0, end).toString("utf8"),
          };
          const { insertedId } = await logs.insertOne(row);
          publish?.({ ...row, _id: insertedId.toHexString() });
          offset += end;
        }
      }
      await logCursors.updateOne(
        { _id: id },
        { $set: { offset, identity } },
        { upsert: true },
      );
    } finally {
      await file.close();
    }
  }
}

export function startLogCollector(publish?: (row: LiveLog) => void, status?: (ok: boolean) => void) {
  let running: Promise<void> | undefined;
  const collect = () => {
    if (running) return;
    running = collectProcessLogs(publish)
      .then(() => status?.(true))
      .catch((error) => { status?.(false); console.error("Falha ao salvar logs do PM2:", error); })
      .finally(() => {
        running = undefined;
      });
  };
  const timer = setInterval(collect, 1000);
  collect();
  return async () => {
    clearInterval(timer);
    await running;
  };
}
