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
import Logo from "./assets/logo.png";
import { Ban, SquareChevronRight } from "lucide-react";

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
};
type Action = "start" | "restart" | "stop" | "delete";

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers);
  if (options?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(url, {
    ...options,
    headers,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message ?? "Não foi possível concluir a operação.");
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}

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

function Login({ onLogin }: { onLogin: () => void }) {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
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
      onLogin();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Falha no login");
    } finally {
      setLoading(false);
    }
  }
  return (
    <main className="grid-bg min-h-screen grid place-items-center p-6">
      <section className="glass w-full max-w-md rounded-3xl border border-slate-200 p-8 shadow-xl shadow-slate-200/60">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-14 w-32 items-center justify-center items-center p-4">
            <img
              src={Logo}
              alt="KPMG"
              width={683}
              height={291}
              className="h-auto w-full"
              decoding="async"
            />
          </div>
        </div>
        <h2 className="text-3xl font-semibold tracking-tight">
          Acesse o painel
        </h2>
        <p className="mt-2 text-sm text-slate-500">
          Realizar login para acessar o monitoramento de processos PM2.
        </p>
        <form onSubmit={submit} className="mt-8 space-y-4">
          <label className="block text-sm text-slate-600">
            Usuário
            <input
              name="username"
              autoComplete="username"
              required
              className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-blue-500"
            />
          </label>
          <label className="block text-sm text-slate-600">
            Senha
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-blue-500"
            />
          </label>
          {error && (
            <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </p>
          )}
          <button
            disabled={loading}
            className="w-full rounded-xl bg-blue-600 px-4 py-3 font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "Entrando…" : "Entrar"}
          </button>
        </form>
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

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const rows = await api<Process[]>("/api/processes");
      setProcesses(rows);
      setAuthenticated(true);
      setError("");
    } catch (reason) {
      if ((reason as Error).message.includes("Sessão")) setAuthenticated(false);
      else setError((reason as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    api("/api/auth/me")
      .then(() => load())
      .catch(() => {
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
      <div className="grid min-h-screen place-items-center bg-[#f4f6fa] text-blue-600">
        <RefreshCw className="animate-spin" />
      </div>
    );
  if (!authenticated) return <Login onLogin={load} />;
  return (
    <main className="grid-bg min-h-screen bg-[#f4f6fa] text-[#465472]">
      <header className="border-b border-[#06245e] bg-[#06245e] text-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white p-1.5 shadow-sm">
              <img
                src={Logo}
                alt="KPMG"
                className="block h-full w-full object-cover"
                decoding="async"
              />
            </div>
            <div className="border-l border-white/25 pl-3">
              <strong className="text-sm tracking-tight">MONITOR PM2</strong>
            </div>
          </div>
          <div className="">
            <button
              onClick={logout}
              title="Sair"
              className="rounded-lg p-2 text-blue-100 hover:bg-white/10 hover:text-white"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-7xl p-5 sm:p-8">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="text-sm font-medium text-blue-600">VISÃO GERAL</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">
              Processos da VM
            </h1>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-[#315789] hover:bg-blue-50"
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
              className="glass rounded-2xl border border-slate-200 p-5"
            >
              <div className="flex items-center justify-between text-sm text-slate-500">
                <span>{label as string}</span>
                <Icon size={18} className="text-blue-600" />
              </div>
              <p className="mt-3 text-2xl font-semibold">{value as string}</p>
            </div>
          ))}
        </section>
        {error && (
          <div className="mt-5 flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <span>{error}</span>
            <button onClick={() => setError("")}>
              <X size={16} />
            </button>
          </div>
        )}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          {notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
          <button
            type="button"
            onClick={() => { setProcessError(""); processDialog.current?.showModal(); }}
            className="ml-auto rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Adicionar novo processo
          </button>
        </div>
        <section className="glass mt-6 overflow-hidden rounded-2xl border border-slate-200">
          <div className="flex flex-col gap-4 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="font-medium">Aplicações</h2>
            <label className="relative">
              <Search
                className="absolute left-3 top-2.5 text-slate-500"
                size={16}
              />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar processo"
                className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500 sm:w-64"
              />
            </label>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-5 py-3">Aplicação</th>
                  <th>Status</th>
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
                    className="border-t border-slate-200/70 transition hover:bg-blue-50/60"
                  >
                    <td className="px-5 py-4">
                      <div className="font-medium">{process.name}</div>
                      <div className="mt-0.5 text-xs text-slate-500">
                        id {process.id} · PID {process.pid || "—"} ·{" "}
                        {process.mode}
                      </div>
                    </td>
                    <td>
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${process.status === "online" ? "bg-[#d8f5e8] text-[#087a56]" : process.status === "stopped" ? "bg-slate-100 text-slate-600" : "bg-[#fff0c2] text-[#936500]"}`}
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-current" />
                        {process.status}
                      </span>
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
                            className="rounded-lg p-2 text-slate-500 hover:bg-amber-50 hover:text-amber-700"
                          >
                            <Ban size={16} />
                          </button>
                        ) : (
                          <button
                            onClick={() => act(process, "start")}
                            title="Iniciar"
                            className="rounded-lg p-2 text-slate-500 hover:bg-emerald-50 hover:text-emerald-700"
                          >
                            <Play size={16} />
                          </button>
                        )}
                        <button
                          onClick={() => act(process, "restart")}
                          title="Reiniciar"
                          className="rounded-lg p-2 text-slate-500 hover:bg-blue-50 hover:text-blue-700"
                        >
                          <RotateCw size={16} />
                        </button>
                        <button
                          onClick={() => showLogs(process)}
                          title="Logs"
                          className="rounded-lg p-2 text-slate-500 hover:bg-blue-50 hover:text-blue-700"
                        >
                          <SquareChevronRight size={16} />
                        </button>
                        <button
                          onClick={() => act(process, "delete")}
                          title="Remover"
                          className="rounded-lg p-2 text-slate-500 hover:bg-red-50 hover:text-red-700"
                        >
                          <Trash2 size={16} />
                        </button>
                        {busy === process.id && (
                          <RefreshCw
                            size={16}
                            className="m-2 animate-spin text-blue-600"
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
            <div className="grid place-items-center px-5 py-16 text-center text-slate-500">
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
        className="m-auto max-h-[90vh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-0 text-[#465472] shadow-2xl backdrop:bg-[#06245e]/40 backdrop:backdrop-blur-sm"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 id="add-process-title" className="text-lg font-semibold">Adicionar novo processo</h2>
          <button type="button" aria-label="Fechar" disabled={addingProcess || pickingFile}
            onClick={() => processDialog.current?.close()}
            className="rounded-lg p-1 text-slate-500 hover:bg-blue-50"><X size={20} /></button>
        </div>
        <form onSubmit={addProcess} className="space-y-4 p-6">
          <p id="ecosystem-help" className="text-sm text-slate-500">
            Informe o caminho do ecosystem.config.js na VM. Todos os processos definidos nele serão iniciados.
          </p>
          <label className="block text-sm font-medium">
            Caminho do ecosystem.config.js
            <input autoFocus value={ecosystemPath}
              onChange={(event) => setEcosystemPath(event.target.value)}
              placeholder="C:\\servicos\\minha-app\\ecosystem.config.js"
              aria-describedby="ecosystem-help" required disabled={addingProcess}
              className="mt-2 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 font-mono text-sm outline-none focus:border-blue-500" />
          </label>
           {processError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{processError}</p>}
          <div className="flex justify-end gap-3 border-t border-slate-200 pt-4">
            <button type="button" disabled={addingProcess || pickingFile} onClick={() => processDialog.current?.close()}
              className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm hover:bg-slate-50">Cancelar</button>
            <button type="submit" disabled={addingProcess || pickingFile || !ecosystemPath.trim()}
              className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">
              {addingProcess ? "Iniciando…" : "Adicionar processo"}
            </button>
          </div>
        </form>
      </dialog>
      {logs && (
        <div
          className="fixed inset-0 z-20 grid place-items-center bg-[#06245e]/40 p-4 backdrop-blur-sm"
          onClick={() => setLogs(null)}
        >
          <section
            onClick={(event) => event.stopPropagation()}
            className="flex max-h-[80vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
          >
            <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div className="flex items-center gap-2">
                <Terminal size={18} className="text-blue-600" />
                <strong>Logs · {logs.name}</strong>
              </div>
              <button
                onClick={() => setLogs(null)}
                className="rounded-lg p-1 text-slate-500 hover:bg-blue-50"
              >
                <X size={18} />
              </button>
            </header>
            <pre className="overflow-auto p-5 text-xs leading-6 text-slate-700">
              {logs.content}
            </pre>
          </section>
        </div>
      )}
    </main>
  );
}
