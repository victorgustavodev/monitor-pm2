import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, Eye, EyeOff, X, Terminal, Plus, FolderOpen } from "lucide-react";
import Logo from "./assets/logo.png";
import { api, ApiError } from "./api";
import { Management } from "./Management";
import { Sidebar, dashboardViews, type DashboardView } from "./Sidebar";
import { Overview } from "./Overview";
import { Applications } from "./Applications";
import { Settings } from "./Settings";
import type { Process, ProcessAction } from "./processes";

function Login({ onLogin, serverError }: { onLogin: () => Promise<void>; serverError: string }) {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const visibleError = error || serverError;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          username: data.get("username"),
          password: data.get("password"),
        }),
      });
      await onLogin();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Falha no login");
    } finally {
      setLoading(false);
    }
  }
  return (
    <main className="login-background">
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-brand">
          <img
            src={Logo}
            alt="KPMG"
            width={214}
            height={113}
            className="brand-logo"
            decoding="async"
          />
        </div>
        <div className="login-content">
          <h2 id="login-title" className="text-2xl font-semibold tracking-tight text-heading">
            Acesse o painel
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            Realizar login para acessar o monitoramento de processos PM2.
          </p>
          <form onSubmit={submit} className="mt-8 space-y-4">
            <label className="block text-sm font-medium text-content">
              Usuário
              <input
                name="username"
                autoComplete="username"
                placeholder="Digite seu usuário"
                required
                className="login-input mt-2"
              />
            </label>
            <div>
              <label htmlFor="login-password" className="block text-sm font-medium text-content">Senha</label>
              <div className="relative mt-2">
                <input
                  id="login-password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="Digite sua senha"
                  required
                  className="login-input login-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                  aria-pressed={showPassword}
                  aria-controls="login-password"
                  className="login-password-toggle"
                >
                  {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                </button>
              </div>
            </div>
            {visibleError && (
              <div role="alert" aria-atomic="true" className="rounded-lg border border-danger-line bg-danger-surface px-4 py-3 text-sm text-danger">
                <p className="font-semibold">Não foi possível acessar o painel</p>
                <p className="mt-1 break-words leading-5">{visibleError}</p>
              </div>
            )}
            <button
              disabled={loading}
              className="h-12 w-full rounded-lg bg-action px-4 text-sm font-semibold text-on-action transition-colors duration-150 hover:bg-action-hover disabled:opacity-50"
            >
              {loading ? "Entrando…" : "Entrar"}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}

export function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [view, setView] = useState<DashboardView>('overview');
  const [username, setUsername] = useState('');
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
      if (reason instanceof ApiError && reason.status === 401) setAuthenticated(false);
      setError((reason as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    api<{ username: string }>("/api/auth/me")
      .then((session) => {
        setUsername(session.username);
        setAuthenticated(true);
        return load();
      })
      .catch((reason: unknown) => {
        if (!(reason instanceof ApiError && reason.status === 401)) {
          setError(reason instanceof Error ? reason.message : "Falha ao verificar sua sessão.");
        }
        setAuthenticated(false);
        setLoading(false);
      });
  }, [load]);
  useEffect(() => {
    if (!authenticated || !autoRefresh) return;
    const timer = window.setInterval(load, 10_000);
    return () => window.clearInterval(timer);
  }, [authenticated, autoRefresh, load]);

  async function onLogin() {
    const session = await api<{ username: string }>('/api/auth/me');
    setUsername(session.username);
    setView('overview');
    setAuthenticated(true);
    await load();
  }


  async function act(process: Process, action: ProcessAction) {
    if (
      action === "delete" &&
      !window.confirm(`Remover ${process.name} da lista do PM2?`)
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
        content: data.logs || "Nenhum log disponível.",
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
      const result = await api<{ path: string | null }>("/api/ecosystems/pick", { method: "POST" });
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
      await api("/api/ecosystems", { method: "POST", body: JSON.stringify({ path: ecosystemPath.trim() }) });
      setNotice("Ecosystem iniciado e lista salva no PM2.");
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
    setProcessError('');
    processDialog.current?.showModal();
  }

  async function logout() {
    setLoggingOut(true);
    try {
      await api("/api/auth/logout", { method: "POST" });
      setAuthenticated(false);
      setUsername('');
      setProcesses([]);
      setNotice('');
      setError('');
    } catch (reason) {
      setError((reason as Error).message);
    } finally { setLoggingOut(false); }
  }

  const currentView = dashboardViews.find((item) => item.id === view)!;
  const managementPanel = view === 'builds' ? 'versions' : view === 'users' || view === 'logs' ? view : null;

  if (authenticated === null)
    return (
      <div className="grid min-h-screen place-items-center bg-canvas text-accent">
        <RefreshCw className="animate-spin" />
      </div>
    );
  if (!authenticated) return <Login onLogin={onLogin} serverError={error} />;
  return (
    <div className="dashboard-shell">
      <a className="skip-link" href="#dashboard-main">Ir para o conteúdo</a>
      <Sidebar view={view} onNavigate={setView} username={username} count={processes.length}
        busy={managementBusy || loggingOut} onLogout={logout} />
      <main id="dashboard-main" className="dashboard-content" tabIndex={-1}>
        <header className="dashboard-page-header">
          <div>
            <p className="page-eyebrow">MONITOR PM2</p>
            <h1>{currentView.label}</h1>
            <p className="page-description">{currentView.description}</p>
          </div>
          <div className="page-actions">
            {!managementPanel && <button type="button" onClick={load} disabled={loading}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-line bg-surface px-4 py-2.5 text-sm font-medium text-action-secondary hover:bg-hover">
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} aria-hidden="true" />Atualizar
            </button>}
            {view === 'processes' && <button type="button"
              onClick={openAddProcess}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-action px-4 py-2.5 text-sm font-semibold text-on-action hover:bg-action-hover">
              <Plus size={16} aria-hidden="true" />Adicionar processo
            </button>}
          </div>
        </header>
        <div className="dashboard-sync" aria-live="off">
          <span className={`sync-dot ${connected ? 'bg-success' : loading ? 'bg-warning' : 'bg-danger'}`} />
          <span>{loading ? 'Atualizando dados…' : updatedAt ? `Atualizado às ${updatedAt.toLocaleTimeString('pt-BR')}` : 'Aguardando dados do PM2'}</span>
          <span className="sync-divider" />
          <span>{autoRefresh ? 'Atualização automática a cada 10 s' : 'Atualização automática pausada'}</span>
        </div>
        {error && <div role="alert" className="mb-5 flex items-center justify-between gap-3 rounded-xl border border-danger-line bg-danger-surface px-4 py-3 text-sm text-danger">
          <span>{error}</span><button type="button" aria-label="Fechar mensagem de erro" onClick={() => setError('')}><X size={16} /></button>
        </div>}
        {notice && <p role="status" className="mb-5 rounded-xl bg-success-surface px-4 py-3 text-sm text-success">{notice}</p>}
        {view === 'overview' && <Overview processes={processes} connected={connected} loading={loading} onProcesses={() => setView('processes')} />}
        {view === 'processes' && <Applications processes={processes} query={query} onQueryChange={setQuery}
          loading={loading} busy={busy} onAction={act} onLogs={showLogs} onAdd={openAddProcess} />}
        {managementPanel && <Management key={managementPanel} panel={managementPanel} onStarted={load}
          onSessionExpired={sessionExpired} onBusyChange={setManagementBusy} />}
        {view === 'settings' && <Settings autoRefresh={autoRefresh} onAutoRefreshChange={setAutoRefresh} username={username} />}
      </main>
      <dialog
        ref={processDialog}
        aria-labelledby="add-process-title"
        aria-describedby="ecosystem-help"
        onCancel={(event) => { if (addingProcess || pickingFile) event.preventDefault(); }}
        onClick={(event) => {
          if (event.target === event.currentTarget && !addingProcess && !pickingFile) {
            const bounds = event.currentTarget.getBoundingClientRect();
            if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) event.currentTarget.close();
          }
        }}
        className="m-auto max-h-[90vh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-2xl border border-line bg-surface p-0 text-content shadow-dialog backdrop:bg-overlay backdrop:backdrop-blur-sm"
      >
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <h2 id="add-process-title" className="text-lg font-semibold">Adicionar novo processo</h2>
          <button type="button" aria-label="Fechar" disabled={addingProcess || pickingFile}
            onClick={() => processDialog.current?.close()}
            className="rounded-lg p-1 text-muted hover:bg-hover"><X size={20} /></button>
        </div>
        <form onSubmit={addProcess} className="space-y-4 p-6">
          <p id="ecosystem-help" className="text-sm text-muted">
            Informe o caminho do ecosystem.config.js na VM. Todos os processos definidos nele serão iniciados.
          </p>
          <label className="block text-sm font-medium">
            Caminho do ecosystem.config.js
            <input autoFocus value={ecosystemPath}
              onChange={(event) => setEcosystemPath(event.target.value)}
              placeholder="C:\\servicos\\minha-app\\ecosystem.config.js"
              aria-describedby="ecosystem-help" required disabled={addingProcess}
              className="mt-2 w-full rounded-lg border border-line bg-canvas px-3 py-2.5 font-mono text-sm outline-none focus:border-focus" />
          </label>
          <button type="button" onClick={selectEcosystem} disabled={addingProcess || pickingFile}
            className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm text-action-secondary hover:bg-hover">
            <FolderOpen size={16} aria-hidden="true" />{pickingFile ? 'Selecionando…' : 'Selecionar na VM'}
          </button>
           {processError && <p role="alert" className="rounded-lg bg-danger-surface p-3 text-sm text-danger">{processError}</p>}
          <div className="flex justify-end gap-3 border-t border-line pt-4">
            <button type="button" disabled={addingProcess || pickingFile} onClick={() => processDialog.current?.close()}
              className="rounded-lg border border-line px-4 py-2.5 text-sm hover:bg-canvas">Cancelar</button>
            <button type="submit" disabled={addingProcess || pickingFile || !ecosystemPath.trim()}
              className="rounded-lg bg-action px-4 py-2.5 text-sm font-semibold text-on-action hover:bg-action-hover">
              {addingProcess ? "Iniciando…" : "Adicionar processo"}
            </button>
          </div>
        </form>
      </dialog>
      {logs && (
        <div
          className="fixed inset-0 z-20 grid place-items-center bg-overlay p-4 backdrop-blur-sm"
          onClick={() => setLogs(null)}
        >
          <section role="dialog" aria-modal="true" aria-label={`Logs de ${logs.name}`}
            onClick={(event) => event.stopPropagation()}
            className="flex max-h-[80vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-dialog"
          >
            <header className="flex items-center justify-between border-b border-line px-5 py-4">
              <div className="flex items-center gap-2">
                <Terminal size={18} className="text-accent" />
                <strong>Logs · {logs.name}</strong>
              </div>
              <button
                onClick={() => setLogs(null)}
                aria-label="Fechar logs"
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
