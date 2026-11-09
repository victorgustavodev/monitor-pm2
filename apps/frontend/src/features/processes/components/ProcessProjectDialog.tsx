import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiError } from "../../../services/api";
import { t } from "../../../i18n";
import type { Process } from "../processes";

type ProjectOption = { _id: string; name: string; deleting?: boolean; deploying?: boolean };
export function ProcessProjectDialog({ process, busy, onSave, onClose, onSessionExpired }: {
  process: Process;
  busy: boolean;
  onSave: (process: Process, projectId: string | null) => Promise<void>;
  onClose: () => void;
  onSessionExpired: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectId, setProjectId] = useState(process.projectId || "");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api<ProjectOption[]>("/api/projects").then(rows => {
      if (active) { setProjects(rows); setLoaded(true); }
    }).catch(reason => {
      if (!active) return;
      setError((reason as Error).message);
      if (reason instanceof ApiError && reason.status === 401) onSessionExpired();
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [attempt, onSessionExpired]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || loading || !loaded) return;
    setError("");
    try { await onSave(process, projectId || null); onClose(); }
    catch (reason) { setError((reason as Error).message); }
  }
  return <dialog ref={dialog} aria-labelledby="process-project-title"
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl border border-line bg-surface p-6 text-content shadow-dialog backdrop:bg-overlay">
    <form onSubmit={submit} className="space-y-4" aria-busy={busy || loading}>
      <h2 id="process-project-title" className="text-lg font-semibold">{t("Vincular projeto a {0}", { 0: process.name })}</h2>
      <label className="block text-sm">{t("Projeto")}
        <select autoFocus value={projectId} onChange={event => setProjectId(event.target.value)} disabled={busy || loading || !loaded}
          className="mt-2 w-full rounded-lg border border-line bg-canvas p-3">
          <option value="">{t("Sem projeto")}</option>
          {process.projectId && !projects.some(project => project._id === process.projectId) &&
            <option value={process.projectId} disabled>{process.projectName}</option>}
          {projects.map(project => <option key={project._id} value={project._id} disabled={project.deleting || project.deploying}>{project.name}</option>)}
        </select>
      </label>
      {loading && <p role="status">{t("Carregando…")}</p>}
      {loaded && !projects.length && <p className="text-sm text-muted">{t("Cadastre um projeto na área Projetos para vincular este processo.")}</p>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {!loaded && !loading && <button type="button" onClick={() => setAttempt(value => value + 1)}>{t("Tentar novamente")}</button>}
      <div className="flex justify-end gap-3">
        <button type="button" disabled={busy} onClick={onClose} className="project-button secondary">{t("Cancelar")}</button>
        <button type="submit" disabled={busy || loading || !loaded} className="project-button">{busy ? t("Salvando…") : t("Salvar")}</button>
      </div>
    </form>
  </dialog>;
}
