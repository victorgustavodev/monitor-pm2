import type { Response } from "express";
import type { ProcessView } from "./pm2.service";

// One collector per backend, regardless of the number of open dashboards.
export function createProcessStream(
  read: () => Promise<ProcessView[]>,
  intervalMs = 5000,
  heartbeatMs = 15000,
) {
  const clients = new Map<
    Response,
    { validate?: () => Promise<boolean>; checking: boolean }
  >();
  let collector: NodeJS.Timeout | undefined;
  let heartbeat: NodeJS.Timeout | undefined;
  let collecting = false;
  let snapshot: string | undefined;
  let signature: string | undefined;

  function write(response: Response, frame: string) {
    if (
      !response.destroyed &&
      !response.writableEnded &&
      !response.write(frame)
    ) {
      // A slow client must not accumulate unbounded metric snapshots.
      response.destroy();
    }
  }

  async function collect() {
    if (collecting || !clients.size) return;
    collecting = true;
    let frame: string;
    let nextSignature: string;
    try {
      const rows = await read();
      frame = `event: processes\ndata: ${JSON.stringify(rows)}\n\n`;
      // Collection timestamps order snapshots but are not process changes.
      nextSignature = JSON.stringify(
        rows.map(({ projectObservedAt: _observedAt, ...row }) => row),
      );
    } catch {
      frame = `event: metrics-error\ndata: ${JSON.stringify({ message: "Não foi possível carregar os processos do PM2. Verifique a conexão do monitor com o PM2 na VM." })}\n\n`;
      nextSignature = frame;
    } finally {
      collecting = false;
    }
    if (!clients.size) return;
    snapshot = frame;
    if (nextSignature === signature) return;
    signature = nextSignature;
    for (const response of clients.keys()) write(response, frame);
  }

  function stopWhenIdle() {
    if (clients.size) return;
    clearInterval(collector);
    clearInterval(heartbeat);
    collector = heartbeat = undefined;
    snapshot = undefined;
    signature = undefined;
  }

  return {
    subscribe(
      response: Response,
      expiresAt: number,
      validate?: () => Promise<boolean>,
    ) {
      response.set({
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      response.flushHeaders();
      clients.set(response, { validate, checking: false });
      const expiry = setTimeout(
        () => {
          write(response, "event: session-expired\ndata: {}\n\n");
          response.end();
        },
        Math.max(0, expiresAt - Date.now()),
      );
      response.once("close", () => {
        clearTimeout(expiry);
        clients.delete(response);
        stopWhenIdle();
      });
      write(response, "retry: 3000\n\n");
      if (snapshot) write(response, snapshot);
      if (!collector) {
        collector = setInterval(() => void collect(), intervalMs);
        heartbeat = setInterval(() => {
          for (const [client, session] of clients) {
            write(client, ": heartbeat\n\n");
            if (!session.validate || session.checking) continue;
            session.checking = true;
            void session
              .validate()
              .then((valid) => {
                if (!valid && clients.has(client)) {
                  write(client, "event: session-expired\ndata: {}\n\n");
                  client.end();
                }
              })
              .catch(() => {
                // Reconnect through authentication after a database failure.
                client.end();
              })
              .finally(() => {
                session.checking = false;
              });
          }
        }, heartbeatMs);
        void collect();
      }
    },
    close() {
      for (const response of clients.keys()) response.end();
      clients.clear();
      stopWhenIdle();
    },
  };
}
