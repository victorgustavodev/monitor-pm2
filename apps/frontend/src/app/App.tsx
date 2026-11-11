import { ProcessProjectDialog } from "../features/processes/components/ProcessProjectDialog";
import { LogTerminal } from "../components/log-terminal/LogTerminal";
import type { ProcessProjectLink } from "../features/processes/processes";
import { dateLocale } from "../i18n";
import { t } from "../i18n";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, X, Terminal, Plus, FolderOpen } from "lucide-react";
import { Login } from "../features/auth/Login";
import { api, ApiError } from "../services/api";
import { Management } from "../features/management/Management";
import {
  Sidebar,
  dashboardViews,
  type DashboardView,
} from "../components/layout/Sidebar";
import { Home } from "../features/home/Home";
import { Applications } from "../features/processes/Applications";
import { Settings } from "../features/settings/Settings";
import { Projects } from "../features/projects/Projects";
import { useBuildPublication } from "../features/projects/useBuildPublication";
import { BuildProgressPanel } from "../features/projects/components/BuildProgressPanel";
import { ProcessActionConfirmation } from "../features/processes/components/ProcessActionConfirmation";
import { useLocale } from "../i18n";
import {
  mergeProcessLabels,
  type Process,
  type ProcessAction,
} from "../features/processes/processes";

export function App() {
  useLocale();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  );
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [view, setView] = useState<DashboardView>("home");
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<"admin" | "user">("user");
  const [connected, setConnected] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const autoRefreshRef = useRef(autoRefresh);
  autoRefreshRef.current = autoRefresh;
  const [liveConnected, setLiveConnected] = useState(false);
  const [liveTick, setLiveTick] = useState(0);
  const [confirmation, setConfirmation] = useState<{ process: Process; action: ProcessAction } | null>(null);
  const [managementBusy, setManagementBusy] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [processes, setProcesses] = useState<Process[]>([]);
  const [loading, setLoading] = useState(true);
  const loadSequence = useRef(0);
  const loadPending = useRef(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<Process["id"] | null>(null);
  const actionPending = useRef(false);
  const [linkProcess, setLinkProcess] = useState<Process | null>(null);
  const [projectSaving, setProjectSaving] = useState(false);
  const [labelSaving, setLabelSaving] = useState(false);
  const processDialog = useRef<HTMLDialogElement>(null);
  const [processError, setProcessError] = useState("");
  const [ecosystemPath, setEcosystemPath] = useState("");
  const [addingProcess, setAddingProcess] = useState(false);
  const [pickingFile, setPickingFile] = useState(false);
  const [notice, setNotice] = useState("");
  const [logs, setLogs] = useState<{ name: string; content: string } | null>(
    null,
  );

  const sessionExpired = useCallback(() => setAuthenticated(false), []);
  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    loadPending.current = true;
    try {
      setLoading(true);
      const rows = await api<Process[]>("/api/processes");
      if (sequence !== loadSequence.current) return;
      setProcesses((current) => mergeProcessLabels(rows, current));
      setConnected(true);
      setUpdatedAt(new Date());
      setError("");
    } catch (reason) {
      if (sequence !== loadSequence.current) return;
      setConnected(false);
      if (reason instanceof ApiError && reason.status === 401)
        setAuthenticated(false);
      setError((reason as Error).message);
    } finally {
      if (sequence === loadSequence.current) { loadPending.current = false; setLoading(false); }
    }
  }, []);
  const buildCompleted = useCallback(async () => { if (autoRefreshRef.current) await load(); }, [load]);
  const publication = useBuildPublication(authenticated === true, username, sessionExpired, buildCompleted);
  useEffect(() => {
    api<{ username: string; role: "admin" | "user" }>("/api/auth/me")
      .then((session) => {
        setUsername(session.username);
        setRole(session.role === "admin" ? "admin" : "user");
        setAuthenticated(true);
        return load();
      })
      .catch((reason: unknown) => {
        if (!(reason instanceof ApiError && reason.status === 401)) {
          setError(
            reason instanceof Error
              ? reason.message
              : t("Falha ao verificar sua sessão."),
          );
        }
        setAuthenticated(false);
        setLoading(false);
      });
  }, [load]);
  useEffect(() => {
    if (!authenticated || !autoRefresh) return;
    setLiveConnected(false);
    let active = true;
    let stream: EventSource;
    let retry: number | undefined;
    function connect() {
      stream = new EventSource("/api/processes/stream");
      stream.addEventListener("processes", (event) => {
        if (!active) return;
        const rows = JSON.parse(
          (event as MessageEvent<string>).data,
        ) as Process[];
        setProcesses((current) => mergeProcessLabels(rows, current));
        setConnected(true);
        setLiveConnected(true);
        setLiveTick(value => value + 1);
        setUpdatedAt(new Date());
        if (!loadPending.current) setLoading(false);
        setError("");
      });
      stream.addEventListener("live", () => {
        if (!active) return;
        setLiveConnected(true); setLiveTick(value => value + 1); setConnected(true); setUpdatedAt(new Date());
      });
      stream.addEventListener("metrics-error", (event) => {
        if (!active) return;
        const data = JSON.parse((event as MessageEvent<string>).data) as {
          message: string;
        };
        setConnected(false);
        setLiveConnected(false);
        if (!loadPending.current) setLoading(false);
        setError(data.message);
      });
      stream.addEventListener("session-expired", () => {
        if (!active) return;
        stream.close();
        setAuthenticated(false);
        setError(t("Sua sessão expirou. Entre novamente."));
      });
      stream.onerror = () => {
        if (!active) return;
        setConnected(false);
        setLiveConnected(false);
        if (!loadPending.current) setLoading(false);
        setError(
          t("Conexão de atualizações interrompida. Tentando reconectar…"),
        );
        // EventSource does not expose the HTTP status of a failed handshake.
        void api("/api/auth/me")
          .then(() => {
            if (active && stream.readyState === EventSource.CLOSED) {
              retry = window.setTimeout(connect, 3000);
            }
          })
          .catch((reason: unknown) => {
            if (!active) return;
            if (reason instanceof ApiError && reason.status === 401) {
              stream.close();
              setAuthenticated(false);
              setError(t("Sua sessão expirou. Entre novamente."));
            } else if (stream.readyState === EventSource.CLOSED) {
              retry = window.setTimeout(connect, 3000);
            }
          });
      };
    }
    connect();
    return () => {
      active = false;
      window.clearTimeout(retry);
      stream.close();
    };
  }, [authenticated, autoRefresh]);

  async function onLogin() {
    const session = await api<{ username: string; role: "admin" | "user" }>(
      "/api/auth/me",
    );
    setUsername(session.username);
    setRole(session.role === "admin" ? "admin" : "user");
    setView("home");
    setLinkProcess(null);
    setAuthenticated(true);
    await load();
  }

  async function executeAction(process: Process, action: ProcessAction) {
    if (publication.processesLocked || busy !== null || actionPending.current) return;
    actionPending.current = true;
    setBusy(process.id);
    setError("");
    try {
      await api(process.startProjectId ? `/api/projects/${process.startProjectId}/start` : `/api/processes/${process.id}/${action}`, { method: "POST", body: JSON.stringify({ name: process.name, namespace: process.namespace || "default" }) });
      await load();
    } catch (reason) {
      if (process.startProjectId) await load();
      setError((reason as Error).message);
      if (reason instanceof ApiError && reason.status === 401) setAuthenticated(false);
      throw reason;
    } finally {
      actionPending.current = false;
      setBusy(null);
    }
  }
  function act(process: Process, action: ProcessAction) {
    if (publication.processesLocked || busy !== null) return;
    if (action === "stop" || action === "delete") setConfirmation({ process, action });
    else void executeAction(process, action).catch(() => undefined);
  }
  async function saveLabel(process: Process, label: string) {
    setBusy(process.id);
    setLabelSaving(true);
    setError("");
    setNotice("");
    try {
      const saved = await api<{
        name: string;
        namespace: string;
        label: string;
        labelUpdatedAt: string;
      }>(`/api/processes/${process.id}/label`, {
        method: "PUT",
        body: JSON.stringify({
          label,
          name: process.name,
          namespace: process.namespace || "default",
        }),
      });
      setProcesses((rows) =>
        rows.map((row) =>
          row.name === saved.name &&
          (row.namespace || "default") === saved.namespace
            ? {
                ...row,
                label: saved.label,
                labelUpdatedAt: saved.labelUpdatedAt,
              }
            : row,
        ),
      );
      setNotice(t("Nome de exibição salvo."));
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401)
        setAuthenticated(false);
      throw reason;
    } finally {
      setBusy(null);
      setLabelSaving(false);
    }
  }
  async function saveProject(process: Process, projectId: string | null) {
    if (busy !== null) return;
    setBusy(process.id);
    setProjectSaving(true);
    setNotice("");
    try {
      const saved = await api<ProcessProjectLink>(`/api/processes/${process.id}/project`, {
        method: "PUT", body: JSON.stringify({ projectId, name: process.name, namespace: process.namespace || "default" }),
      });
      setProcesses(rows => rows.map(row => row.name === saved.name && (row.namespace || "default") === saved.namespace
        ? { ...row, ...saved } : row));
      setNotice(t("Vínculo do projeto salvo."));
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) setAuthenticated(false);
      throw reason;
    } finally { setBusy(null); setProjectSaving(false); }
  }
  function openProject(id: string) {
    setSelectedProjectId(id);
    setView("projects");
  }
  async function showLogs(process: Process) {
    setBusy(process.id);
    try {
      const data = await api<{ logs: string }>(
        `/api/processes/${process.id}/logs?lines=150`,
      );
      setLogs({
        name: process.label || process.name,
        content: data.logs || t("Nenhum log disponível."),
      });
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(null);
    }
  }
  async function selectEcosystem() {
    setPickingFile(true);
    setProcessError("");
    try {
      const result = await api<{ path: string | null }>(
        "/api/ecosystems/pick",
        { method: "POST" },
      );
      if (result.path) setEcosystemPath(result.path);
    } catch (reason) {
      setProcessError((reason as Error).message);
    } finally {
      setPickingFile(false);
    }
  }

  async function addProcess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (publication.processesLocked) return;
    setAddingProcess(true);
    setProcessError("");
    setNotice("");
    try {
      await api("/api/ecosystems", {
        method: "POST",
        body: JSON.stringify({ path: ecosystemPath.trim() }),
      });
      setNotice(t("Ecosystem iniciado e lista salva no PM2."));
      setEcosystemPath("");
      processDialog.current?.close();
      await load();
    } catch (reason) {
      setProcessError((reason as Error).message);
    } finally {
      setAddingProcess(false);
    }
  }

  function openAddProcess() {
    if (publication.processesLocked) return;
    setProcessError("");
    processDialog.current?.showModal();
  }

  async function logout() {
    setLoggingOut(true);
    try {
      await api("/api/auth/logout", { method: "POST" });
      setAuthenticated(false);
      setUsername("");
      setProcesses([]);
      setNotice("");
      setError("");
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setLoggingOut(false);
    }
  }

  const currentView = dashboardViews.find((item) => item.id === view)!;
  const managementPanel = view === "logs" || (view === "users" && role === "admin") ? view : null;

  if (authenticated === null)
    return (
      <div className="grid min-h-screen place-items-center bg-canvas text-accent">
        <RefreshCw className="animate-spin" />
      </div>
    );
  if (!authenticated) return <Login onLogin={onLogin} serverError={error} />;
  return (
    <div className="dashboard-shell">
      <a className="skip-link" href="#dashboard-main">
        {t("Ir para o conteúdo")}
      </a>
      <Sidebar
        isAdmin={role === "admin"}
        view={view}
        onNavigate={setView}
        username={username}
        count={processes.length}
        busy={managementBusy || loggingOut || labelSaving || projectSaving || addingProcess || pickingFile || actionPending.current}
        onLogout={logout}
      />
      <main key={view} id="dashboard-main" className="dashboard-content page-enter" tabIndex={-1}>
        <header className="dashboard-page-header">
          <div>
            <p className="page-eyebrow">MONITOR PM2</p>
            <h1>
              {view === "home"
                ? t("Olá, {0}", { 0: username })
                : t(currentView.label)}
            </h1>
            <p className="page-description">{t(currentView.description)}</p>
          </div>
          <div className="page-actions">
            {["home", "settings"].includes(view) && (
              <button
                type="button"
                onClick={load}
                disabled={loading}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-line bg-surface px-4 py-2.5 text-sm font-medium text-action-secondary hover:bg-hover"
              >
                <RefreshCw
                  size={16}
                  className={loading ? "animate-spin" : ""}
                  aria-hidden="true"
                />
                {t("Atualizar")}
              </button>
            )}
            {view === "home" && (
              <button
                type="button"
                disabled={busy !== null || publication.processesLocked}
                onClick={openAddProcess}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-action px-4 py-2.5 text-sm font-semibold text-on-action hover:bg-action-hover"
              >
                <Plus size={16} aria-hidden="true" />
                {t("Adicionar processo")}
              </button>
            )}
          </div>
        </header>
        <div className="dashboard-sync" aria-live="off">
          <span
            className={`sync-dot ${connected ? "bg-success" : loading ? "bg-warning" : "bg-danger"}`}
          />
          <span className="sync-updated">
            {loading
              ? t("Atualizando dados…")
              : updatedAt
                ? t("Atualizado às {0}", {
                    0: updatedAt.toLocaleTimeString(dateLocale()),
                  })
                : t("Aguardando dados do PM2")}
          </span>
          <span className="sync-divider" />
          <button type="button" className={`live-indicator ${!autoRefresh ? "paused" : liveConnected ? "active" : "reconnecting"}`} aria-pressed={autoRefresh} onClick={() => setAutoRefresh(value => !value)} title={t(autoRefresh ? "Pausar atualizações" : "Retomar atualizações")}>
            <span key={liveTick} className="live-indicator-dot" aria-hidden="true" />
            {t(autoRefresh ? "Pausar" : "Retomar")}
          </button>
        </div>
        {error && (
          <div
            role="alert"
            className="mb-5 flex items-center justify-between gap-3 rounded-xl border border-danger-line bg-danger-surface px-4 py-3 text-sm text-danger"
          >
            <span>{error}</span>
            <button
              type="button"
              aria-label={t("Fechar mensagem de erro")}
              onClick={() => setError("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {notice && (
          <p
            role="status"
            className="mb-5 rounded-xl bg-success-surface px-4 py-3 text-sm text-success"
          >
            {notice}
          </p>
        )}
        {view === "home" && (
          <Home processes={processes} connected={connected} loading={loading}>
            {publication.processesLocked && <p role="status" className="project-message">{t(publication.ready ? "As ações dos processos estão bloqueadas durante publicações." : "Sincronizando publicações antes de liberar ações dos processos…")}</p>}
            <Applications
              onProjectEdit={setLinkProcess}
              onOpenProject={openProject}
              onLabelSave={saveLabel}
              processes={processes}
              query={query}
              onQueryChange={setQuery}
              loading={loading}
              busy={publication.processesLocked ? -1 : busy}
              onAction={act}
              onLogs={showLogs}
              onAdd={openAddProcess}
            />
          </Home>
        )}
        {managementPanel && (
          <Management
            processes={processes}
            key={managementPanel}
            panel={managementPanel}
            onSessionExpired={sessionExpired}
            onBusyChange={setManagementBusy}
            onRoleChanged={(name, nextRole) => { if (name === username) { setRole(nextRole); if (nextRole !== "admin") setView("home"); } }}
          />
        )}
        {view === "projects" && (
          <Projects
            processes={processes}
            processesConnected={connected}
            publication={publication}
            projectId={selectedProjectId}
            onSelectProject={setSelectedProjectId}
            onStarted={load}
            onSessionExpired={sessionExpired}
            onBusyChange={setManagementBusy}
          />
        )}
        {view === "settings" && (
          <Settings
            onBusyChange={setManagementBusy}
            onSessionExpired={sessionExpired}
            autoRefresh={autoRefresh}
            onAutoRefreshChange={setAutoRefresh}
            username={username}
          />
        )}
      </main>
      <BuildProgressPanel publication={publication} />
      {confirmation && <ProcessActionConfirmation process={confirmation.process} action={confirmation.action}
        locked={publication.processesLocked || busy !== null}
        onConfirm={() => executeAction(confirmation.process, confirmation.action)} onClose={() => setConfirmation(null)} />}
      {linkProcess && <ProcessProjectDialog process={linkProcess} busy={projectSaving || publication.processesLocked}
        onSave={saveProject} onClose={() => setLinkProcess(null)} onSessionExpired={sessionExpired} />}
      <dialog
        ref={processDialog}
        aria-labelledby="add-process-title"
        aria-describedby="ecosystem-help"
        onCancel={(event) => {
          if (addingProcess || pickingFile) event.preventDefault();
        }}
        onClick={(event) => {
          if (
            event.target === event.currentTarget &&
            !addingProcess &&
            !pickingFile
          ) {
            const bounds = event.currentTarget.getBoundingClientRect();
            if (
              event.clientX < bounds.left ||
              event.clientX > bounds.right ||
              event.clientY < bounds.top ||
              event.clientY > bounds.bottom
            )
              event.currentTarget.close();
          }
        }}
        className="m-auto max-h-[90vh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-2xl border border-line bg-surface p-0 text-content shadow-dialog backdrop:bg-overlay backdrop:backdrop-blur-sm"
      >
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <h2 id="add-process-title" className="text-lg font-semibold">
            {t("Adicionar novo processo")}
          </h2>
          <button
            type="button"
            aria-label={t("Fechar")}
            disabled={addingProcess || pickingFile}
            onClick={() => processDialog.current?.close()}
            className="rounded-lg p-1 text-muted hover:bg-hover"
          >
            <X size={20} />
          </button>
        </div>
        <form onSubmit={addProcess} className="space-y-4 p-6">
          <p id="ecosystem-help" className="text-sm text-muted">
            {t(
              "Informe o caminho do ecosystem.config.js na VM. Todos os processos definidos nele serão iniciados.",
            )}
          </p>
          <label className="block text-sm font-medium">
            {t("Caminho do ecosystem.config.js")}
            <input
              autoFocus
              value={ecosystemPath}
              onChange={(event) => setEcosystemPath(event.target.value)}
              placeholder="C:\\servicos\\minha-app\\ecosystem.config.js"
              aria-describedby="ecosystem-help"
              required
              disabled={addingProcess || publication.processesLocked}
              className="mt-2 w-full rounded-lg border border-line bg-canvas px-3 py-2.5 font-mono text-sm outline-none focus:border-focus"
            />
          </label>
          <button
            type="button"
            onClick={selectEcosystem}
            disabled={addingProcess || pickingFile || publication.processesLocked}
            className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm text-action-secondary hover:bg-hover"
          >
            <FolderOpen size={16} aria-hidden="true" />
            {pickingFile ? t("Selecionando…") : t("Selecionar na VM")}
          </button>
          {processError && (
            <p
              role="alert"
              className="rounded-lg bg-danger-surface p-3 text-sm text-danger"
            >
              {processError}
            </p>
          )}
          <div className="flex justify-end gap-3 border-t border-line pt-4">
            <button
              type="button"
              disabled={addingProcess || pickingFile}
              onClick={() => processDialog.current?.close()}
              className="rounded-lg border border-line px-4 py-2.5 text-sm hover:bg-canvas"
            >
              {t("Cancelar")}
            </button>
            <button
              type="submit"
              disabled={addingProcess || pickingFile || publication.processesLocked || !ecosystemPath.trim()}
              className="rounded-lg bg-action px-4 py-2.5 text-sm font-semibold text-on-action hover:bg-action-hover"
            >
              {addingProcess ? t("Iniciando…") : t("Adicionar processo")}
            </button>
          </div>
        </form>
      </dialog>
      {logs && (
        <div
          className="modal-overlay fixed inset-0 z-20 grid place-items-center bg-overlay p-4 backdrop-blur-sm"
          onClick={() => setLogs(null)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label={t("Logs de {0}", { 0: logs.name })}
            onClick={(event) => event.stopPropagation()}
            className="flex max-h-[80vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-dialog"
          >
            <header className="flex items-center justify-between border-b border-line px-5 py-4">
              <div className="flex items-center gap-2">
                <Terminal size={18} className="text-accent" />
                <strong>
                  {t("Logs ·")} {logs.name}
                </strong>
              </div>
              <button
                onClick={() => setLogs(null)}
                aria-label={t("Fechar logs")}
                className="rounded-lg p-1 text-muted hover:bg-hover"
              >
                <X size={18} />
              </button>
            </header>
            <LogTerminal content={logs.content} label={t("Logs de {0}", { 0: logs.name })} />
          </section>
        </div>
      )}
    </div>
  );
}
