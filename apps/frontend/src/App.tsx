import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Activity from "lucide-react/dist/esm/icons/activity.js";
import CircleOff from "lucide-react/dist/esm/icons/circle-off.js";
import Cpu from "lucide-react/dist/esm/icons/cpu.js";
import Database from "lucide-react/dist/esm/icons/database.js";
import LogOut from "lucide-react/dist/esm/icons/log-out.js";
import MemoryStick from "lucide-react/dist/esm/icons/memory-stick.js";
import Play from "lucide-react/dist/esm/icons/play.js";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw.js";
import RotateCw from "lucide-react/dist/esm/icons/rotate-cw.js";
import Search from "lucide-react/dist/esm/icons/search.js";
import ShieldCheck from "lucide-react/dist/esm/icons/shield-check.js";
import Square from "lucide-react/dist/esm/icons/square.js";
import Terminal from "lucide-react/dist/esm/icons/terminal.js";
import Trash2 from "lucide-react/dist/esm/icons/trash-2.js";
import X from "lucide-react/dist/esm/icons/x.js";
import Eye from "lucide-react/dist/esm/icons/eye.js";
import EyeOff from "lucide-react/dist/esm/icons/eye-off.js";
import Logo from "./assets/logo.png";
import { Ban, SquareChevronRight } from "lucide-react";
import { api, ApiError } from "./api";
import { Management } from "./Management";

type Process = {
  id: number;
  name: string;
  status: string;
  pid: number;
  cpu: number;
  memory: number;
  uptime: number | null;
  restarts: number;
  mode: string;
  version: string | null;
  ports: number[];
  portSource: "listening" | "configured" | null;
};
type Action = "start" | "restart" | "stop" | "delete";

const formatMemory = (bytes: number) =>
  `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const formatUptime = (since: number | null) => {
  if (!since) return "—";
  const seconds = Math.max(0, Math.floor((Date.now() - since) / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return days
    ? `${days}d ${hours}h`
    : hours
      ? `${hours}h ${minutes}m`
      : `${minutes}m`;
};

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
      setAuthenticated(true);
      setError("");
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) setAuthenticated(false);
      setError((reason as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    api("/api/auth/me")
      .then(() => load())
      .catch((reason: unknown) => {
        if (!(reason instanceof ApiError && reason.status === 401)) {
          setError(reason instanceof Error ? reason.message : "Falha ao verificar sua sessão.");
        }
        setAuthenticated(false);
        setLoading(false);
      });
  }, [load]);
  useEffect(() => {
    if (!authenticated) return;
    const timer = window.setInterval(load, 10_000);
    return () => clearInterval(timer);
  }, [authenticated, load]);

  const filtered = useMemo(
    () =>
      processes.filter((item) =>
        item.name.toLowerCase().includes(query.toLowerCase()),
      ),
    [processes, query],
  );
  const online = processes.filter((item) => item.status === "online").length;
  const memory = processes.reduce((total, item) => total + item.memory, 0);
  const cpu = processes.reduce((total, item) => total + item.cpu, 0);

  async function act(process: Process, action: Action) {
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

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    setAuthenticated(false);
  }

  if (authenticated === null)
    return (
      <div className="grid min-h-screen place-items-center bg-canvas text-accent">
        <RefreshCw className="animate-spin" />
      </div>
    );
  if (!authenticated) return <Login onLogin={load} serverError={error} />;
  return (
    <main className="grid-bg min-h-screen bg-canvas text-content">
      <header className="brand-header text-on-brand">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-3">
          <div className="flex items-center gap-3">
            <div className="h-16 w-28 shrink-0">
              <img
                src={Logo}
                alt="KPMG"
                width={214}
                height={113}
                className="brand-logo"
                decoding="async"
              />
            </div>
            <div className="border-l border-shell-line pl-3">
              <strong className="text-sm tracking-tight">MONITOR PM2</strong>
            </div>
          </div>
          <div className="">
            <button
              onClick={logout}
              title="Sair"
              className="rounded-lg p-2 text-shell-muted hover:bg-shell-hover hover:text-on-brand"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-7xl p-5 sm:p-8">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="text-sm font-medium text-accent">VISÃO GERAL</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">
              Processos da VM
            </h1>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center justify-center gap-2 rounded-xl border border-line bg-surface px-4 py-2.5 text-sm text-action-secondary hover:bg-hover"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            Atualizar
          </button>
        </div>
        <section className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Online", `${online}/${processes.length}`, Activity],
            ["CPU total", `${cpu.toFixed(1)}%`, Cpu],
            ["Memória", formatMemory(memory), MemoryStick],
            ["Daemon", "Conectado", Database],
          ].map(([label, value, Icon]) => (
            <div
              key={String(label)}
              className="glass rounded-2xl border border-line p-5"
            >
              <div className="flex items-center justify-between text-sm text-muted">
                <span>{label as string}</span>
                <Icon size={18} className="text-accent" />
              </div>
              <p className="mt-3 text-2xl font-semibold">{value as string}</p>
            </div>
          ))}
        </section>
        {error && (
          <div className="mt-5 flex items-center justify-between rounded-xl border border-danger-line bg-danger-surface px-4 py-3 text-sm text-danger">
            <span>{error}</span>
            <button onClick={() => setError("")}>
              <X size={16} />
            </button>
          </div>
        )}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          {notice && <p role="status" className="text-sm text-success">{notice}</p>}
          <button
            type="button"
            onClick={() => { setProcessError(""); processDialog.current?.showModal(); }}
            className="ml-auto rounded-lg bg-action px-4 py-2.5 text-sm font-semibold text-on-action hover:bg-action-hover"
          >
            Adicionar novo processo
          </button>
        </div>
        <Management onStarted={load} onSessionExpired={sessionExpired} />
        <section className="glass mt-6 overflow-hidden rounded-2xl border border-line">
          <div className="flex flex-col gap-4 border-b border-line p-4 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="font-medium">Aplicações</h2>
            <label className="relative">
              <Search
                className="absolute left-3 top-2.5 text-muted"
                size={16}
              />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar processo"
                className="w-full rounded-lg border border-line bg-canvas py-2 pl-9 pr-3 text-sm outline-none focus:border-focus sm:w-64"
              />
            </label>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-left text-sm">
              <thead className="bg-canvas text-xs uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-5 py-3">Aplicação</th>
                  <th>Status</th>
                  <th>Porta</th>
                  <th>CPU</th>
                  <th>Memória</th>
                  <th>Uptime</th>
                  <th>Reinícios</th>
                  <th className="px-5 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((process) => (
                  <tr
                    key={process.id}
                    className="border-t border-line/70 transition hover:bg-hover/60"
                  >
                    <td className="px-5 py-4">
                      <div className="font-medium">{process.name}</div>
                      <div className="mt-0.5 text-xs text-muted">
                        id {process.id} · PID {process.pid || "—"} ·{" "}
                        {process.mode}
                      </div>
                    </td>
                    <td>
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${process.status === "online" ? "bg-success-surface text-success" : process.status === "stopped" ? "bg-subtle text-muted" : "bg-warning-surface text-warning"}`}
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-current" />
                        {process.status}
                      </span>
                    </td>
                    <td>
                      <span className="font-mono tabular-nums" title={process.portSource === "listening" ? "Portas TCP em escuta neste processo ou em seus subprocessos" : process.portSource === "configured" ? "Porta informada na configuração; não confirmada em escuta" : "Porta não identificada"}>
                        {process.ports?.length ? process.ports.join(", ") : "—"}
                      </span>
                      {process.portSource === "configured" && <p className="mt-0.5 text-xs text-muted">Configurada</p>}
                    </td>
                    <td>{process.cpu.toFixed(1)}%</td>
                    <td>{formatMemory(process.memory)}</td>
                    <td>{formatUptime(process.uptime)}</td>
                    <td>{process.restarts}</td>
                    <td className="px-5">
                      <div className="flex justify-end gap-1">
                        {process.status === "online" ? (
                          <button
                            onClick={() => act(process, "stop")}
                            title="Parar"
                            className="rounded-lg p-2 text-muted hover:bg-warning-surface hover:text-warning"
                          >
                            <Ban size={16} />
                          </button>
                        ) : (
                          <button
                            onClick={() => act(process, "start")}
                            title="Iniciar"
                            className="rounded-lg p-2 text-muted hover:bg-success-surface hover:text-success"
                          >
                            <Play size={16} />
                          </button>
                        )}
                        <button
                          onClick={() => act(process, "restart")}
                          title="Reiniciar"
                          className="rounded-lg p-2 text-muted hover:bg-hover hover:text-link-hover"
                        >
                          <RotateCw size={16} />
                        </button>
                        <button
                          onClick={() => showLogs(process)}
                          title="Logs"
                          className="rounded-lg p-2 text-muted hover:bg-hover hover:text-link-hover"
                        >
                          <SquareChevronRight size={16} />
                        </button>
                        <button
                          onClick={() => act(process, "delete")}
                          title="Remover"
                          className="rounded-lg p-2 text-muted hover:bg-danger-surface hover:text-danger"
                        >
                          <Trash2 size={16} />
                        </button>
                        {busy === process.id && (
                          <RefreshCw
                            size={16}
                            className="m-2 animate-spin text-accent"
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!loading && filtered.length === 0 && (
            <div className="grid place-items-center px-5 py-16 text-center text-muted">
              <CircleOff size={32} />
              <p className="mt-3">Nenhum processo encontrado.</p>
            </div>
          )}
        </section>
      </div>
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
          <section
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
    </main>
  );
}
