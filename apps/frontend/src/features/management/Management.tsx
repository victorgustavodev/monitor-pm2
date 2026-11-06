import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../../services/api";

export type ManagementPanel = "versions" | "users" | "logs";
type Version = {
  _id: string;
  project: string;
  version: string;
  originalName: string;
  size: number;
  createdAt: string;
  createdBy: string;
  ecosystem?: string;
  status: string;
  error?: string;
  startedAt?: string;
};
type User = { id: string; username: string; createdAt: string };
type Log = {
  _id: string;
  kind: "audit" | "process";
  createdAt: string;
  username?: string;
  ip?: string;
  method?: string;
  path?: string;
  status?: number;
  processId?: number;
  processName?: string;
  source?: string;
  content?: string;
};
const inputStyle =
  "mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-focus";
const buttonStyle =
  "rounded-lg bg-action px-4 py-2 text-sm font-semibold text-on-action hover:bg-action-hover disabled:opacity-50";
const date = (value: string) => new Date(value).toLocaleString("pt-BR");
const statuses: Record<string, string> = {
  processing: "Extraindo",
  ready: "Salva",
  starting: "Iniciando",
  started: "Iniciada",
  failed: "Falha",
};

export function Management({
  panel,
  onStarted,
  onSessionExpired,
  onBusyChange,
}: {
  panel: ManagementPanel;
  onStarted: () => Promise<void>;
  onSessionExpired: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [kind, setKind] = useState("audit");
  const [processId, setProcessId] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    onBusyChange(busy);
  }, [busy, onBusyChange]);
  useEffect(() => () => onBusyChange(false), [onBusyChange]);

  const fail = useCallback(
    (reason: unknown) => {
      setError(
        reason instanceof Error
          ? reason.message
          : "Não foi possível concluir a operação.",
      );
      if (reason instanceof ApiError && reason.status === 401)
        onSessionExpired();
    },
    [onSessionExpired],
  );

  const load = useCallback(async () => {
    if (!panel) return;
    setLoading(true);
    setError("");
    try {
      if (panel === "versions")
        setVersions(await api<Version[]>("/api/versions"));
      if (panel === "users") setUsers(await api<User[]>("/api/users"));
      if (panel === "logs") {
        const query = new URLSearchParams({ kind, limit: "100" });
        if (kind === "process" && processId) query.set("processId", processId);
        setLogs(await api<Log[]>(`/api/logs?${query}`));
      }
    } catch (reason) {
      fail(reason);
    } finally {
      setLoading(false);
    }
  }, [panel, kind, processId, fail]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (panel === "versions") {
        await api("/api/versions", { method: "POST", body: data });
        setNotice(
          "Build salvo e versionado. Você já pode baixar o RAR ou iniciar a versão.",
        );
      } else {
        await api("/api/users", {
          method: "POST",
          body: JSON.stringify({
            username: data.get("username"),
            password: data.get("password"),
          }),
        });
        setNotice("Usuário criado. Ele já pode entrar no painel.");
      }
      form.reset();
      await load();
    } catch (reason) {
      fail(reason);
    } finally {
      setBusy(false);
    }
  }

  async function start(version: Version) {
    if (
      !window.confirm(
        `Iniciar ${version.project} ${version.version}? Os processos com os mesmos nomes no PM2 serão atualizados para este build.`,
      )
    )
      return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api(`/api/versions/${version._id}/start`, { method: "POST" });
      setNotice(`Versão ${version.version} enviada ao PM2.`);
      await onStarted();
      await load();
    } catch (reason) {
      await load();
      fail(reason);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Gerenciamento">
      <div
        id="management-panel"
        className="rounded-2xl border border-line bg-surface p-5 sm:p-6"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="font-semibold">
            {panel === "versions"
              ? "Builds versionados"
              : panel === "users"
                ? "Usuários do painel"
                : "Logs salvos"}
          </h2>
          <button
            type="button"
            onClick={load}
            disabled={loading || busy}
            className="text-sm text-link hover:text-link-hover disabled:opacity-50"
          >
            {loading ? "Carregando…" : "Atualizar"}
          </button>
        </div>
        {error && (
          <p
            role="alert"
            className="mb-4 rounded-lg bg-danger-surface p-3 text-sm text-danger"
          >
            {error}
          </p>
        )}
        {notice && (
          <p
            role="status"
            className="mb-4 rounded-lg bg-success-surface p-3 text-sm text-success"
          >
            {notice}
          </p>
        )}
        {panel === "versions" && (
          <>
            <p className="mb-4 text-sm text-muted">
              Envie o build pronto em um arquivo .rar. Cada versão preserva o
              arquivo original. Para iniciar pelo painel, inclua um
              ecosystem.config.js com caminhos relativos ao build.
            </p>
            <form
              onSubmit={submit}
              className="mb-5 flex flex-wrap items-end gap-3"
            >
              <label className="min-w-40 flex-1 text-sm">
                Projeto
                <input
                  name="project"
                  required
                  maxLength={80}
                  pattern="[a-zA-Z0-9][a-zA-Z0-9._\-]*"
                  placeholder="minha-app"
                  disabled={busy}
                  className={inputStyle}
                />
              </label>
              <label className="min-w-32 flex-1 text-sm">
                Versão
                <input
                  name="version"
                  required
                  maxLength={80}
                  pattern="[a-zA-Z0-9][a-zA-Z0-9._\-]*"
                  placeholder="1.0.0"
                  disabled={busy}
                  className={inputStyle}
                />
              </label>
              <label className="min-w-52 flex-1 text-sm">
                Build .rar
                <input
                  name="build"
                  type="file"
                  accept=".rar"
                  required
                  disabled={busy}
                  className={inputStyle}
                />
              </label>
              <button disabled={busy} className={buttonStyle}>
                {busy ? "Salvando…" : "Salvar versão"}
              </button>
            </form>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[650px] text-left text-sm">
                <thead className="bg-canvas text-muted">
                  <tr>
                    <th className="p-3">Projeto / versão</th>
                    <th>Enviado por</th>
                    <th>Data</th>
                    <th>Estado</th>
                    <th className="text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {versions.map((version) => (
                    <tr key={version._id} className="border-t border-line">
                      <td className="p-3">
                        <strong>
                          {version.project} · {version.version}
                        </strong>
                        <p className="text-xs text-muted">
                          {version.originalName} ·{" "}
                          {(version.size / 1024 / 1024).toFixed(1)} MB
                        </p>
                        {version.error && (
                          <p className="mt-1 max-w-xs text-xs text-danger">
                            {version.error}
                          </p>
                        )}
                      </td>
                      <td>{version.createdBy}</td>
                      <td>
                        {date(version.createdAt)}
                        {version.startedAt && (
                          <p className="text-xs text-muted">
                            Última execução: {date(version.startedAt)}
                          </p>
                        )}
                      </td>
                      <td>{statuses[version.status] || version.status}</td>
                      <td className="py-3 text-right">
                        {version.status !== "processing" && (
                          <a
                            className="mr-3 text-link hover:text-link-hover hover:underline"
                            href={`/api/versions/${version._id}/archive`}
                          >
                            Baixar RAR
                          </a>
                        )}
                        <button
                          type="button"
                          className={buttonStyle}
                          disabled={
                            busy ||
                            !version.ecosystem ||
                            ["processing", "starting"].includes(version.status)
                          }
                          onClick={() => start(version)}
                          title={
                            version.ecosystem
                              ? "Iniciar esta versão no PM2"
                              : "Inclua exatamente um ecosystem.config.js no RAR para iniciar"
                          }
                        >
                          Iniciar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!loading && !versions.length && (
              <p className="py-6 text-center text-sm text-muted">
                Nenhuma versão enviada.
              </p>
            )}
          </>
        )}
        {panel === "users" && (
          <>
            <p className="mb-4 text-sm text-muted">
              Os usuários cadastrados podem gerenciar processos, versões e criar
              outros usuários.
            </p>
            <form
              onSubmit={submit}
              className="mb-5 flex flex-wrap items-end gap-3"
            >
              <label className="min-w-40 flex-1 text-sm">
                Usuário
                <input
                  name="username"
                  autoComplete="off"
                  required
                  minLength={3}
                  maxLength={64}
                  pattern="[a-zA-Z0-9_.\-]+"
                  disabled={busy}
                  className={inputStyle}
                />
              </label>
              <label className="min-w-52 flex-1 text-sm">
                Senha (mínimo 12 caracteres)
                <input
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={12}
                  maxLength={256}
                  disabled={busy}
                  className={inputStyle}
                />
              </label>
              <button disabled={busy} className={buttonStyle}>
                {busy ? "Criando…" : "Criar usuário"}
              </button>
            </form>
            <ul className="divide-y divide-line">
              {users.map((user) => (
                <li
                  key={user.id}
                  className="flex flex-wrap justify-between gap-2 py-3 text-sm"
                >
                  <strong>{user.username}</strong>
                  <span className="text-muted">
                    Criado em {date(user.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
        {panel === "logs" && (
          <>
            <div className="mb-4 flex flex-wrap items-end gap-3">
              <label className="text-sm">
                Tipo
                <select
                  value={kind}
                  onChange={(event) => setKind(event.target.value)}
                  className={inputStyle}
                >
                  <option value="audit">Ações do painel</option>
                  <option value="process">Saída dos processos</option>
                </select>
              </label>
              {kind === "process" && (
                <label className="text-sm">
                  ID do processo (opcional)
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={processId}
                    onChange={(event) => setProcessId(event.target.value)}
                    className={inputStyle}
                  />
                </label>
              )}
            </div>
            <p className="mb-3 text-xs text-muted">
              Últimos 100 registros. A saída dos processos é coletada a cada 5
              segundos.
            </p>
            <div className="max-h-[500px] space-y-3 overflow-auto">
              {logs.map((log) => (
                <article
                  key={log._id}
                  className="rounded-lg border border-line p-3 text-sm"
                >
                  <div className="flex flex-wrap justify-between gap-2">
                    <strong>
                      {log.kind === "audit"
                        ? `${log.username || "Sem sessão"} · ${log.method} ${log.path} · HTTP ${log.status}`
                        : `${log.processName} · processo ${log.processId}`}
                    </strong>
                    <time className="text-xs text-muted">
                      {date(log.createdAt)}
                    </time>
                  </div>
                  {log.kind === "audit" ? (
                    <p className="mt-1 text-xs text-muted">IP: {log.ip}</p>
                  ) : (
                    <>
                      <p className="mt-1 break-all text-xs text-muted">
                        {log.source}
                      </p>
                      <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-xs leading-5">
                        {log.content}
                      </pre>
                    </>
                  )}
                </article>
              ))}
            </div>
            {!loading && !logs.length && (
              <p className="py-6 text-center text-sm text-muted">
                Nenhum log salvo para este filtro.
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
