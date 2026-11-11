import { dateLocale } from "../../i18n";
import { t } from "../../i18n";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { api, ApiError } from "../../services/api";
import { LogTerminal } from "../../components/log-terminal/LogTerminal";
import type { Process } from "../processes/processes";

export type ManagementPanel = "users" | "logs";
type User = {
  id: string;
  username: string;
  createdAt: string;
  role: "admin" | "user";
};
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
const date = (value: string) => new Date(value).toLocaleString(dateLocale());
export function Management({
  panel,
  onSessionExpired,
  onBusyChange,
  onRoleChanged,
  processes,
}: {
  panel: ManagementPanel;
  onSessionExpired: () => void;
  onBusyChange: (busy: boolean) => void;
  onRoleChanged: (username: string, role: User["role"]) => void;
  processes: Process[];
}) {
  const [users, setUsers] = useState<User[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [kind, setKind] = useState("process");
  const [processName, setProcessName] = useState("");
  const [sources, setSources] = useState<Array<{ name: string }>>([]);
  const requestId = useRef(0);
  const applications = useMemo(() => {
    const names = new Map(sources.map(source => [source.name, source.name]));
    for (const process of processes) if (!process.startProjectId || process.label)
      names.set(process.name, process.label ? `${process.label} (${process.name})` : process.name);
    return [...names].sort((a, b) => a[1].localeCompare(b[1]));
  }, [sources, processes]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [roleDrafts, setRoleDrafts] = useState<Record<string, User["role"]>>({});
  const [savingRole, setSavingRole] = useState<string | null>(null);

  useEffect(() => {
    onBusyChange(busy);
  }, [busy, onBusyChange]);
  useEffect(() => () => onBusyChange(false), [onBusyChange]);

  const fail = useCallback(
    (reason: unknown) => {
      setError(
        reason instanceof Error
          ? reason.message
          : t("Não foi possível concluir a operação."),
      );
      if (reason instanceof ApiError && reason.status === 401)
        onSessionExpired();
    },
    [onSessionExpired],
  );

  const load = useCallback(async () => {
    if (!panel) return;
    const id = ++requestId.current;
    setLoading(true);
    setError("");
    setLogs([]);
    try {
      if (panel === "users") setUsers(await api<User[]>("/api/users"));
      if (panel === "logs") {
        if (kind === "process" && !processName) return;
        const query = new URLSearchParams({ kind, limit: "100" });
        if (kind === "process") query.set("processName", processName);
        const rows = await api<Log[]>(`/api/logs?${query}`);
        if (id === requestId.current) setLogs(rows);
      }
    } catch (reason) {
      if (id === requestId.current) fail(reason);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [panel, kind, processName, fail]);

  useEffect(() => {
    void load();
    return () => { requestId.current++; };
  }, [load]);
  useEffect(() => {
    if (panel !== "logs") return;
    let active = true;
    void api<Array<{ name: string }>>("/api/logs/applications")
      .then(rows => { if (active) setSources(rows); })
      .catch(reason => { if (active) fail(reason); });
    return () => { active = false; };
  }, [panel, fail]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setError("");
    setNotice("");
    try {
        await api("/api/users", {
          method: "POST",
          body: JSON.stringify({
            username: data.get("username"),
            password: data.get("password"),
            role: data.get("role"),
          }),
        });
        setNotice(t("Usuário criado. Ele já pode entrar no painel."));
      form.reset();
      await load();
    } catch (reason) {
      fail(reason);
    } finally {
      setBusy(false);
    }
  }
  async function saveRole(user: User) {
    if (busy) return;
    setBusy(true); setSavingRole(user.id); setError(""); setNotice("");
    try {
      const saved = await api<User>(`/api/users/${user.id}/role`, { method: "PUT", body: JSON.stringify({ role: roleDrafts[user.id] || user.role }) });
      setUsers(values => values.map(value => value.id === saved.id ? saved : value));
      setRoleDrafts(values => ({ ...values, [saved.id]: saved.role }));
      setNotice(t("Perfil do usuário atualizado."));
      onRoleChanged(saved.username, saved.role);
    } catch (reason) { fail(reason); }
    finally { setBusy(false); setSavingRole(null); }
  }

  return (
    <section aria-label={t("Gerenciamento")}>
      <div
        id="management-panel"
        className="rounded-2xl border border-line bg-surface p-5 sm:p-6"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="font-semibold">
            {panel === "users"
                ? t("Usuários do painel")
                : t("Logs salvos")}
          </h2>
          <button
            type="button"
            onClick={load}
            disabled={loading || busy}
            className="text-sm text-link hover:text-link-hover disabled:opacity-50"
          >
            {loading ? t("Carregando…") : t("Atualizar")}
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
        {panel === "users" && (
          <>
            <p className="mb-4 text-sm text-muted">
              {t(
                "Usuários comuns podem operar o monitor. Apenas administradores acessam o gerenciamento de usuários.",
              )}
            </p>
            <form
              onSubmit={submit}
              className="mb-5 flex flex-wrap items-end gap-3"
            >
              <label className="min-w-40 flex-1 text-sm">
                {t("Usuário")}
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
                {t("Senha (mínimo 12 caracteres)")}
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
              <label className="min-w-40 flex-1 text-sm">
                {t("Perfil")}
                <select
                  name="role"
                  defaultValue="user"
                  disabled={busy}
                  className={inputStyle}
                >
                  <option value="user">{t("Usuário comum")}</option>
                  <option value="admin">{t("Administrador")}</option>
                </select>
              </label>
              <button disabled={busy} className={buttonStyle}>
                {busy && !savingRole ? t("Criando…") : t("Criar usuário")}
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
                    {t(
                      user.role === "admin" ? "Administrador" : "Usuário comum",
                    )}{" "}
                    · {t("Criado em")} {date(user.createdAt)}
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    <select aria-label={t("Perfil de {0}", { 0: user.username })} className={inputStyle} disabled={busy}
                      value={roleDrafts[user.id] || user.role} onChange={event => setRoleDrafts(values => ({ ...values, [user.id]: event.target.value as User["role"] }))}>
                      <option value="user">{t("Usuário comum")}</option><option value="admin">{t("Administrador")}</option>
                    </select>
                    <button className={buttonStyle} disabled={busy || !roleDrafts[user.id] || roleDrafts[user.id] === user.role} onClick={() => void saveRole(user)} aria-label={t("Salvar perfil de {0}", { 0: user.username })}>{savingRole === user.id ? t("Salvando…") : t("Salvar perfil")}</button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
        {panel === "logs" && (
          <>
            <div className="mb-4 flex flex-wrap items-end gap-3">
              <label className="text-sm">
                {t("Tipo")}
                <select
                  value={kind}
                  onChange={(event) => setKind(event.target.value)}
                  className={inputStyle}
                >
                  <option value="process">{t("Logs das aplicações")}</option>
                  <option value="audit">{t("Ações do painel")}</option>
                </select>
              </label>
              {kind === "process" && (
                <label className="text-sm">
                  {t("Aplicação")}
                  <select
                    value={processName}
                    onChange={(event) => setProcessName(event.target.value)}
                    className={inputStyle}
                  >
                    <option value="">{t("Selecione uma aplicação")}</option>
                    {applications.map(([name, label]) => <option key={name} value={name}>{label}</option>)}
                  </select>
                </label>
              )}
            </div>
            {kind === "process" && !processName ? <p role="status" className="py-6 text-center text-sm text-muted">{t("Selecione uma aplicação para exibir os logs.")}</p> : <p className="mb-3 text-xs text-muted">
              {t(
                "Últimos 100 registros. A saída dos processos é coletada a cada 5 segundos.",
              )}
            </p>}
            {loading && <p role="status">{t("Carregando…")}</p>}
            <div className="max-h-[500px] space-y-3 overflow-auto">
              {logs.map((log) => (
                <article
                  key={log._id}
                  className="rounded-lg border border-line p-3 text-sm"
                >
                  <div className="flex flex-wrap justify-between gap-2">
                    <strong>
                      {log.kind === "audit"
                        ? `${log.username || t("Sem sessão")} · ${log.method} ${log.path} · HTTP ${log.status}`
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
                      <LogTerminal content={log.content || ""} label={t("Logs de {0}", { 0: log.processName })} />
                    </>
                  )}
                </article>
              ))}
            </div>
            {!loading && !logs.length && (kind !== "process" || processName) && (
              <p className="py-6 text-center text-sm text-muted">
                {t("Nenhum log salvo para este filtro.")}
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
