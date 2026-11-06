import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { logCursors, logs } from "../common/database";
import { processLogSources } from "../pm2/pm2.service";

export async function collectProcessLogs() {
  const sources = await processLogSources();
  const seen = new Set<string>();
  for (const source of sources) {
    if (seen.has(source.path)) continue;
    seen.add(source.path);
    const file = await open(source.path, "r").catch(() => null);
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
          await logs.insertOne({
            kind: "process",
            createdAt: new Date(),
            processId: source.id,
            processName: source.name,
            source: source.path,
            content: buffer.subarray(0, end).toString("utf8"),
          });
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

export function startLogCollector() {
  let running: Promise<void> | undefined;
  const collect = () => {
    if (running) return;
    running = collectProcessLogs()
      .catch((error) => console.error("Falha ao salvar logs do PM2:", error))
      .finally(() => {
        running = undefined;
      });
  };
  const timer = setInterval(collect, 5000);
  collect();
  return async () => {
    clearInterval(timer);
    await running;
  };
}
