import { useEffect, useRef, useState } from "react";
import { LogTerminal } from "../../../components/log-terminal/LogTerminal";
import { api, ApiError } from "../../../services/api";
import { t } from "../../../i18n";

export function ProcessLogTerminal({ name, namespace, onSessionExpired }: {
  name: string; namespace?: string; onSessionExpired: () => void;
}) {
  const [content, setContent] = useState("");
  const [status, setStatus] = useState<"loading" | "live" | "error">("loading");
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const latest = useRef("");
  useEffect(() => {
    let active = true;
    let stream: EventSource;
    let retry: number | undefined;
    const query = new URLSearchParams({ processName: name });
    if (namespace !== undefined) query.set("namespace", namespace);
    setContent(""); latest.current = ""; setStatus("loading");
    function connect() {
      stream = new EventSource(`/api/logs/stream?${query}`);
      const receive = (event: Event, replace: boolean) => {
        if (!active) return;
        const data = JSON.parse((event as MessageEvent<string>).data) as { content: string };
        latest.current = (replace ? data.content : latest.current + data.content).slice(-200_000);
        if (!pausedRef.current) setContent(latest.current);
        setStatus("live");
      };
      stream.addEventListener("snapshot", event => receive(event, true));
      stream.addEventListener("log", event => receive(event, false));
      stream.addEventListener("live", () => { if (active) setStatus("live"); });
      stream.addEventListener("logs-error", () => { if (active) setStatus("error"); });
      stream.addEventListener("session-expired", () => {
        if (active) { stream.close(); onSessionExpired(); }
      });
      stream.onerror = () => {
        if (!active) return;
        setStatus("error");
        stream.close();
        void api("/api/auth/me").catch(reason => {
          if (active && reason instanceof ApiError && reason.status === 401) {
            active = false; onSessionExpired();
          }
        }).finally(() => { if (active) retry = window.setTimeout(connect, 3000); });
      };
    }
    connect();
    return () => { active = false; stream.close(); window.clearTimeout(retry); };
  }, [name, namespace, onSessionExpired]);
  function togglePause() {
    pausedRef.current = !pausedRef.current;
    setPaused(pausedRef.current);
    if (!pausedRef.current) setContent(latest.current);
  }
  return <div className="flex min-h-0 flex-col">
    <div className="flex items-center justify-between gap-3 px-4 py-2 text-xs text-muted">
      <span role="status">{t(status === "loading" ? "Conectando aos logs…" : status === "error"
        ? "Logs sem conexão. Tentando reconectar…" : paused ? "Exibição pausada" : "Logs em tempo real")}</span>
      <button type="button" className="text-link" onClick={togglePause}>{t(paused ? "Retomar" : "Pausar")}</button>
    </div>
    <LogTerminal content={content || (status === "loading" ? t("Carregando…") : t("Nenhum log disponível."))}
      label={t("Logs de {0}", { 0: name })} follow />
  </div>;
}
