import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiError } from "../../../services/api";
import { t } from "../../../i18n";
import type { Project } from "../types";

type EnvironmentFile = { name: string; content: string; revision: string | null; names?: string[] };

export function ProjectEnvironmentFiles({ project, busy, onBusyChange, onSessionExpired }: {
  project: Project;
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
  onSessionExpired: () => void;
}) {
  const [name, setName] = useState(".env");
  const [openedName, setOpenedName] = useState(".env");
  const [file, setFile] = useState<EnvironmentFile | null>(null);
  const [names, setNames] = useState<string[]>([]);
  const [content, setContent] = useState("");
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const url = `/api/projects/${project._id}/environment-files/${encodeURIComponent(openedName)}`;
  useEffect(() => {
    let active = true;
    setLoading(true);
    setFile(null);
    setError("");
    setNotice("");
    void api<EnvironmentFile>(url).then(value => {
      if (!active) return;
      setFile(value);
      setContent(value.content);
      setNames(value.names || []);
    }).catch((reason: unknown) => {
      if (!active) return;
      if (reason instanceof ApiError && reason.status === 401) onSessionExpired();
      setError(reason instanceof Error ? reason.message : t("Não foi possível concluir a operação."));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [url, revision, onSessionExpired]);
  const locked = busy || project.deploying || loading || saving;
  function openFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked) return;
    setOpenedName(name.trim());
    setRevision(value => value + 1);
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked || !file || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    onBusyChange(true);
    setError("");
    setNotice("");
    try {
      const saved = await api<EnvironmentFile>(url, { method: "PUT", body: JSON.stringify({ content, revision: file.revision }) });
      setFile(saved);
      setNames(values => [...new Set([...values, saved.name])].sort());
      setNotice(t("Arquivo de ambiente salvo. A aplicação não foi reiniciada."));
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) onSessionExpired();
      setError(reason instanceof Error ? reason.message : t("Não foi possível concluir a operação."));
    } finally {
      savingRef.current = false;
      setSaving(false);
      onBusyChange(false);
    }
  }
  return <section className="project-form-card project-details">
    <div className="project-section-heading"><div>
      <h2>{t("Arquivos .env")}</h2>
      <p>{t("Edite ou crie arquivos .env na raiz do projeto. Salvar não reinicia a aplicação.")}</p>
    </div></div>
    <form className="project-form" onSubmit={openFile}>
      <label>{t("Nome do arquivo de ambiente")}
        <input name="environmentFileName" list="project-environment-files" value={name} onChange={event => setName(event.target.value)} required maxLength={128} pattern="\.env(\.[a-zA-Z0-9_\-][a-zA-Z0-9._\-]*)?" disabled={locked} />
        <datalist id="project-environment-files">{[...new Set([".env", ...names])].map(value => <option key={value} value={value} />)}</datalist>
        <small>{t("Use .env ou um nome como .env.production, na raiz do projeto.")}</small>
      </label>
      <div className="project-form-actions"><button className="project-button secondary" disabled={locked}>{t("Abrir / recarregar arquivo")}</button></div>
    </form>
    {loading && <p role="status" className="project-message">{t("Carregando arquivo de ambiente…")}</p>}
    {error && <p role="alert" className="project-message error">{error}</p>}
    {notice && <p role="status" className="project-message success">{notice}</p>}
    {file && <form className="project-form" onSubmit={save}>
      <label>{file.name}
        <textarea name="environmentContent" rows={12} value={content} onChange={event => setContent(event.target.value)} maxLength={32768} disabled={locked} spellCheck={false} className="project-pm2-code" />
        <small>{file.revision === null ? t("Arquivo ainda não existe. Ele será criado ao salvar.") : t("Alterações serão gravadas no arquivo da pasta do projeto.")}</small>
        <small>{t("Texto UTF-8, até 32 KB. O conteúdo não é executado pelo monitor.")}</small>
      </label>
      <div className="project-form-actions"><button className="project-button" disabled={locked || (file.revision !== null && file.content === content)}>{saving ? t("Salvando…") : t("Salvar arquivo de ambiente")}</button></div>
    </form>}
  </section>;
}
