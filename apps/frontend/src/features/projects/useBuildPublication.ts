import { useEffect, useRef, useState } from "react";
import { api } from "../../services/api";
import { t } from "../../i18n";

export type Publication = {
  id: string; percent: number; stage: string;
  status: "running" | "succeeded" | "failed" | "cancelled";
  cancellable: boolean; logs: string[];
};
export function useBuildPublication() {
  const [progress, setProgress] = useState<Publication | null>(null);
  const [connectionError, setConnectionError] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const current = useRef<{ project: string; id: string } | null>(null);
  const stream = useRef<EventSource | null>(null);
  useEffect(() => () => stream.current?.close(), []);

  async function run(project: string, path: string, body?: FormData) {
    setConnectionError(""); setCancelling(false);
    setProgress({ id: "", percent: 0, stage: body ? "Enviando pacote" : "Preparando publicação", status: "running", cancellable: false, logs: [] });
    try {
      const operation = await api<Publication>(`/api/projects/${project}/build-operations`, { method: "POST" });
      current.current = { project, id: operation.id };
      setProgress(operation);
      const events = new EventSource(`/api/projects/${project}/build-operations/${operation.id}/stream`);
      stream.current = events;
      events.addEventListener("progress", (event) => {
        const next = JSON.parse((event as MessageEvent<string>).data) as Publication;
        setProgress(next.status === "cancelled" ? { ...next, status: "running" } : next); setConnectionError("");
      });
      events.addEventListener("error", () => setConnectionError(t("Conexão de atualizações interrompida. Tentando reconectar…")));
      events.addEventListener("session-expired", () => { events.close(); setConnectionError(t("Sua sessão expirou. Entre novamente.")); });
      await api(`${path}?operationId=${encodeURIComponent(operation.id)}`, { method: "POST", body });
      setProgress(previous => previous && ({ ...previous, percent: 100, stage: "Build publicado", status: "succeeded", cancellable: false }));
    } catch (error) {
      const wasCancelled = cancellingRef.current;
      const operation = current.current;
      if (operation) void api(`/api/projects/${operation.project}/build-operations/${operation.id}/cancel`, { method: "POST" }).catch(() => undefined);
      setProgress(previous => previous && ({ ...previous, status: previous.status === "cancelled" || wasCancelled ? "cancelled" : "failed", cancellable: false, stage: wasCancelled ? "Publicação cancelada" : "Falha ao publicar o build", logs: [...previous.logs, error instanceof Error ? error.message : String(error)] }));
      throw error;
    } finally {
      stream.current?.close(); stream.current = null; current.current = null;
      setCancelling(false); cancellingRef.current = false;
    }
  }
  const cancellingRef = useRef(false);
  async function cancel() {
    const operation = current.current;
    if (!operation || cancellingRef.current) return;
    cancellingRef.current = true; setCancelling(true); setConnectionError("");
    try {
      const next = await api<Publication>(`/api/projects/${operation.project}/build-operations/${operation.id}/cancel`, { method: "POST" });
      // The publication request remains pending until server-side restoration finishes.
      setProgress(previous => previous?.status === "running" ? { ...next, status: "running" } : previous);
    } catch (error) {
      cancellingRef.current = false; setCancelling(false);
      setConnectionError(error instanceof Error ? error.message : String(error));
    }
  }
  return { progress, connectionError, cancelling, run, cancel, close: () => setProgress(null) };
}
