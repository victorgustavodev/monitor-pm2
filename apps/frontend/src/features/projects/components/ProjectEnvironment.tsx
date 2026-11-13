import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../../../services/api";
import { t } from "../../../i18n";
import type { FileView, Project } from "../types";
import { Pm2ConfigurationField } from "./Pm2ConfigurationField";
import { ProjectEnvironmentFiles } from "./ProjectEnvironmentFiles";

export function ProjectEnvironment({ project, busy, onSave, onBusyChange, onSessionExpired }: {
  project: Project;
  busy: boolean;
  onSave: (data: FormData) => Promise<void>;
  onBusyChange: (busy: boolean) => void;
  onSessionExpired: () => void;
}) {
  const [file, setFile] = useState<FileView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setFile(null);
    void api<FileView>(`/api/projects/${project._id}/files?path=${encodeURIComponent(project.pm2ConfigPath)}`)
      .then((value) => { if (active) setFile(value); })
      .catch((reason: unknown) => {
        if (!active) return;
        if (reason instanceof ApiError && reason.status === 401) onSessionExpired();
        if (!(reason instanceof ApiError && reason.status === 404))
          setError(reason instanceof Error ? reason.message : t("Não foi possível concluir a operação."));
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [project._id, project.pm2ConfigPath, revision, onSessionExpired]);
  const locked = busy || project.deploying || loading || Boolean(error);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!locked && !file) await onSave(new FormData(event.currentTarget));
  }
  return <><section className="project-form-card project-details">
    <div className="project-section-heading">
      <div>
        <h2>{t("Variáveis de ambiente")}</h2>
        <p>{t("Configuração e variáveis env do ecosystem do projeto.")}</p>
      </div>
      <button className="project-button secondary" disabled={busy || loading} onClick={() => setRevision(value => value + 1)}>{t("Atualizar")}</button>
    </div>
    <p className="project-form-note"><code>{project.pathToRunPm2}</code></p>
    {loading ? <p role="status" className="project-message">{t("Verificando configuração local…")}</p>
      : error ? <p role="alert" className="project-message error">{error}</p>
      : file ? <>
        {file.type === "file" && !file.binary ? <ProjectEnvironmentFiles key={project.pm2ConfigPath} project={project} busy={busy}
          configFile={project.pm2ConfigPath} onBusyChange={onBusyChange} onSessionExpired={onSessionExpired} />
          : <p role="alert" className="project-message error">{t("O caminho da configuração PM2 deve ser um arquivo de texto.")}</p>}
      </> : <>
        <p role="status" className="project-message">{t("Nenhum ecosystem encontrado na pasta do projeto. Salve a configuração abaixo para usá-la na próxima publicação.")}</p>
        <form className="project-form" onSubmit={save}>
          <Pm2ConfigurationField content={project.pm2ConfigContent} disabled={locked} />
          <div className="project-form-actions"><button className="project-button" disabled={locked}>{busy ? t("Salvando…") : t("Salvar alterações")}</button></div>
        </form>
      </>}
  </section>
    <ProjectEnvironmentFiles project={project} busy={busy} onBusyChange={onBusyChange} onSessionExpired={onSessionExpired} />
  </>;
}
