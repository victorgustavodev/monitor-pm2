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
import { Builds } from "../features/projects/Builds";
import { useLocale } from "../i18n";
import type { Process, ProcessAction } from "../features/processes/processes";

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
  const [managementBusy, setManagementBusy] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [processes, setProcesses] = useState<Process[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
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
    try {
      setLoading(true);
      const rows = await api<Process[]>("/api/processes");
      setProcesses(rows);
      setConnected(true);
      setUpdatedAt(new Date());
      setError("");
    } catch (reason) {
      setConnected(false);
      if (reason instanceof ApiError && reason.status === 401)
        setAuthenticated(false);
      setError((reason as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
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
    let active = true;
    let stream: EventSource;
    let retry: number | undefined;
    function connect() {
      stream = new EventSource("/api/processes/stream");
      stream.addEventListener("processes", (event) => {
        if (!active) return;
        setProcesses(
          JSON.parse((event as MessageEvent<string>).data) as Process[],
        );
        setConnected(true);
        setUpdatedAt(new Date());
        setLoading(false);
        setError("");
      });
      stream.addEventListener("metrics-error", (event) => {
        if (!active) return;
        const data = JSON.parse((event as MessageEvent<string>).data) as {
          message: string;
        };
        setConnected(false);
        setLoading(false);
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
        setLoading(false);
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
    setAuthenticated(true);
    await load();
  }

  async function act(process: Process, action: ProcessAction) {
    if (
      action === "delete" &&
      !window.confirm(t("Remover {0} da lista do PM2?", { 0: process.name }))
    )
      return;
    setBusy(process.id);
    setError("");
    try {
      await api(`/api/processes/${process.id}/${action}`, { method: "POST" });
      await load();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(null);
    }
  }
  async function showLogs(process: Process) {
    setBusy(process.id);
    try {
      const data = await api<{ logs: string }>(
        `/api/processes/${process.id}/logs?lines=150`,
      );
      setLogs({
        name: process.name,
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
  const managementPanel = view === "logs" ? view : null;

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
        view={view}
        onNavigate={setView}
        username={username}
        count={processes.length}
        busy={managementBusy || loggingOut}
        onLogout={logout}
      />
      <main id="dashboard-main" className="dashboard-content" tabIndex={-1}>
        <header className="dashboard-page-header">
          <div>
            <p className="page-eyebrow">MONITOR PM2</p>
            <h1>{view === 'home' ? t('Olá, {0}', { 0: username }) : t(currentView.label)}</h1>
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
          <span>
            {loading
              ? t("Atualizando dados…")
              : updatedAt
                ? t("Atualizado às {0}", {
                    0: updatedAt.toLocaleTimeString(dateLocale()),
                  })
                : t("Aguardando dados do PM2")}
          </span>
          <span className="sync-divider" />
          <span>
            {autoRefresh
              ? t("Atualização ao vivo")
              : t("Atualização ao vivo pausada")}
          </span>
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
            <Applications
              processes={processes}
              query={query}
              onQueryChange={setQuery}
              loading={loading}
              busy={busy}
              onAction={act}
              onLogs={showLogs}
              onAdd={openAddProcess}
            />
          </Home>
        )}
        {managementPanel && (
          <Management
            key={managementPanel}
            panel={managementPanel}
            onStarted={load}
            onSessionExpired={sessionExpired}
            onBusyChange={setManagementBusy}
          />
        )}
        {view === "projects" && (
          <Projects
            projectId={selectedProjectId}
            onSelectProject={setSelectedProjectId}
            onStarted={load}
            onSessionExpired={sessionExpired}
            onBusyChange={setManagementBusy}
          />
        )}
        {view === "builds" && (
          <Builds
            onStarted={load}
            onSessionExpired={sessionExpired}
            onBusyChange={setManagementBusy}
            onOpenProject={(id) => {
              setSelectedProjectId(id);
              setView("projects");
            }}
          />
        )}
        {view === "settings" && (
          <Settings
            isAdmin={role === "admin"}
            onBusyChange={setManagementBusy}
            onSessionExpired={sessionExpired}
            autoRefresh={autoRefresh}
            onAutoRefreshChange={setAutoRefresh}
            username={username}
          />
        )}
      </main>
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
              disabled={addingProcess}
              className="mt-2 w-full rounded-lg border border-line bg-canvas px-3 py-2.5 font-mono text-sm outline-none focus:border-focus"
            />
          </label>
          <button
            type="button"
            onClick={selectEcosystem}
            disabled={addingProcess || pickingFile}
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
              disabled={addingProcess || pickingFile || !ecosystemPath.trim()}
              className="rounded-lg bg-action px-4 py-2.5 text-sm font-semibold text-on-action hover:bg-action-hover"
            >
              {addingProcess ? t("Iniciando…") : t("Adicionar processo")}
            </button>
          </div>
        </form>
      </dialog>
      {logs && (
        <div
          className="fixed inset-0 z-20 grid place-items-center bg-overlay p-4 backdrop-blur-sm"
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
            <pre className="overflow-auto p-5 text-xs leading-6 text-content">
              {logs.content}
            </pre>
          </section>
        </div>
      )}
    </div>
  );
}
