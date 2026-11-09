import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../../services/api";
import { t } from "../../i18n";

export type Publication = {
  id: string; percent: number; stage: string;
  status: "running" | "succeeded" | "failed" | "cancelled";
  cancellable: boolean; logs: string[];
  projectId: string; projectName: string; username: string; canCancel: boolean;
};
export type BuildPublications = ReturnType<typeof useBuildPublication>;

export function useBuildPublication(enabled: boolean, username: string, onSessionExpired: () => void, onCompleted: () => Promise<void>) {
  const [tasks, setTasks] = useState<Publication[]>([]);
  const [ready, setReady] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const [revision, setRevision] = useState(0);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [cancelling, setCancelling] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState<string[]>([]);
  const pending = useRef(new Set<string>());
  const known = useRef(new Map<string, Publication["status"]>());
  const merge = useCallback((rows: Publication[]) => {
    let finished = false;
    for (const row of rows) {
      if (known.current.get(row.id) === "running" && row.status !== "running") finished = true;
      known.current.set(row.id, row.status);
    }
    setTasks(rows);
    if (finished) { setRevision(value => value + 1); void onCompleted().catch(() => undefined); }
  }, [onCompleted]);
  useEffect(() => {
    if (!enabled) {
      setTasks([]); setReady(false); setDismissed([]); known.current.clear();
      return;
    }
    let active = true;
    let events: EventSource;
    let retry: number | undefined;
    function connect() {
      events = new EventSource("/api/build-operations/stream");
      events.addEventListener("publications", event => {
        if (!active) return;
        merge(JSON.parse((event as MessageEvent<string>).data) as Publication[]);
        setReady(true); setConnectionError("");
      });
      events.addEventListener("session-expired", () => { if (active) { events.close(); onSessionExpired(); } });
      events.onerror = () => {
        if (!active) return;
        setReady(false);
        setConnectionError(t("Conexão de publicações interrompida. Aguardando reconexão…"));
        void api("/api/auth/me").then(() => {
          if (active && events.readyState === EventSource.CLOSED) retry = window.setTimeout(connect, 3000);
        }).catch(reason => { if (active && reason instanceof ApiError && reason.status === 401) onSessionExpired(); });
      };
    }
    connect();
    return () => { active = false; events.close(); window.clearTimeout(retry); };
  }, [enabled, merge, onSessionExpired]);

  async function run(project: string, path: string, body?: FormData, projectName = "Projeto") {
    if (!ready || pending.current.has(project) || tasks.some(task => task.projectId === project && task.status === "running"))
      throw new Error(t("Já existe uma publicação em andamento neste projeto ou a conexão está indisponível."));
    pending.current.add(project); setSubmitting(values => [...values, project]);
    let operation: Publication | undefined;
    try {
      operation = await api<Publication>(`/api/projects/${project}/build-operations`, { method: "POST" });
      const row = { ...operation, projectId: project, projectName, username, canCancel: operation.cancellable };
      setTasks(values => [...values.filter(value => value.id !== row.id), row]);
      known.current.set(row.id, row.status);
      await api(`${path}?operationId=${encodeURIComponent(operation.id)}&background=true`, { method: "POST", body });
    } catch (error) {
      if (operation && error instanceof ApiError && error.status !== 0)
        void api(`/api/projects/${project}/build-operations/${operation.id}/cancel`, { method: "POST" }).catch(() => undefined);
      throw error;
    } finally { pending.current.delete(project); setSubmitting(values => values.filter(value => value !== project)); }
  }
  async function cancel(task: Publication) {
    if (cancelling.includes(task.id)) return;
    setCancelling(values => [...values, task.id]);
    try { await api(`/api/projects/${task.projectId}/build-operations/${task.id}/cancel`, { method: "POST" }); }
    catch (error) { setConnectionError(error instanceof Error ? error.message : String(error)); }
    finally { setCancelling(values => values.filter(value => value !== task.id)); }
  }
  return { tasks, ready, connectionError, revision, submitting, cancelling, run, cancel,
    dismiss: (id: string) => setDismissed(values => [...values, id]),
    visible: tasks.filter(task => task.status === "running" || !dismissed.includes(task.id)),
    isProjectBusy: (id: string) => !ready || submitting.includes(id) || tasks.some(task => task.projectId === id && task.status === "running"),
    processesLocked: !ready || submitting.length > 0 || tasks.some(task => task.status === "running"),
  };
}
