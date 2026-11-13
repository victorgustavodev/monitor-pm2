import type { Response } from "express";

export type LiveLog = { _id: string; processName?: string; namespace?: string; content?: string };
export type LogSelection = { processName: string; namespace?: string };
const maxCharacters = 200_000;

function content(rows: LiveLog[]) {
  return rows.map(row => row.content || "").join("").slice(-maxCharacters);
}

// The persistent collector feeds all terminals; opening a terminal never starts PM2 CLI polling.
export function createLogStream(read: (selection: LogSelection) => Promise<LiveLog[]>, heartbeatMs = 15000) {
  const clients = new Map<Response, { selection: LogSelection; pending: LiveLog[] | null }>();
  function send(response: Response, event: string, data: unknown) {
    if (response.destroyed || response.writableEnded) return;
    if (response.writableLength > 1024 * 1024) { response.destroy(); return; }
    response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
  return {
    publish(row: LiveLog) {
      for (const [response, client] of clients) {
        if (client.selection.processName !== row.processName ||
          (client.selection.namespace !== undefined && client.selection.namespace !== (row.namespace || "default"))) continue;
        if (client.pending) {
          client.pending.push(row);
          if (client.pending.length > 100) response.destroy();
        } else send(response, "log", { content: content([row]) });
      }
    },
    status(ok: boolean) {
      for (const response of clients.keys()) send(response, ok ? "live" : "logs-error", {});
    },
    async subscribe(response: Response, selection: LogSelection, expiresAt: number, validate: () => Promise<boolean>) {
      response.set({ "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive", "X-Accel-Buffering": "no" });
      response.flushHeaders();
      const client = { selection, pending: [] as LiveLog[] | null };
      clients.set(response, client);
      const expire = () => { send(response, "session-expired", {}); response.end(); };
      const expiry = setTimeout(expire, Math.max(0, expiresAt - Date.now()));
      let checking = false;
      const heartbeat = setInterval(() => {
        if (checking) return;
        checking = true;
        void validate().then(valid => {
          if (!valid) expire();
          else send(response, "heartbeat", {});
        }).catch(() => response.end()).finally(() => { checking = false; });
      }, heartbeatMs);
      response.once("close", () => { clearTimeout(expiry); clearInterval(heartbeat); clients.delete(response); });
      response.write("retry: 3000\n\n");
      try {
        const rows = await read(selection);
        if (!clients.has(response)) return;
        const ids = new Set(rows.map(row => row._id));
        const pending = client.pending!.filter(row => !ids.has(row._id));
        send(response, "snapshot", { content: content([...rows, ...pending]) });
        client.pending = null;
      } catch {
        send(response, "logs-error", {});
        response.end();
      }
    },
    close() {
      for (const response of clients.keys()) response.end();
      clients.clear();
    },
  };
}
