import { t } from "../../i18n";
import { useEffect, useState } from "react";
import { api, ApiError } from "../../services/api";
import { Management } from "../management/Management";
import { BuildHistory } from "./components/BuildHistory";
import type { Project } from "./types";

export function Builds({
  onStarted,
  onSessionExpired,
  onBusyChange,
  onOpenProject,
}: {
  onStarted: () => Promise<void>;
  onSessionExpired: () => void;
  onBusyChange: (busy: boolean) => void;
  onOpenProject: (id: string) => void;
}) {
  const [legacy, setLegacy] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    onBusyChange(busy);
  }, [busy, onBusyChange]);
  useEffect(() => () => onBusyChange(false), [onBusyChange]);
  useEffect(() => {
    const controller = new AbortController();
    void api<Project[]>("/api/projects", { signal: controller.signal })
      .then((rows) => {
        if (!controller.signal.aborted) setProjects(rows);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        if (reason instanceof ApiError && reason.status === 401)
          onSessionExpired();
        setError(
          reason instanceof Error
            ? reason.message
            : t("Não foi possível carregar os projetos."),
        );
      });
    return () => controller.abort();
  }, [onSessionExpired]);
  return (
    <div className="projects-content">
      <div
        className="repository-tabs"
        role="tablist"
        aria-label={t("Tipos de build")}
      >
        <button
          role="tab"
          aria-selected={!legacy}
          disabled={busy}
          onClick={() => setLegacy(false)}
        >
          {t("Builds de projetos")}</button>
        <button
          role="tab"
          aria-selected={legacy}
          disabled={busy}
          onClick={() => setLegacy(true)}
        >
          {t("Uploads avulsos")}</button>
      </div>
      {error && (
        <p role="alert" className="project-message error">
          {error}
        </p>
      )}
      {legacy ? (
        <>
          <p className="project-form-note">
            {t("Uploads avulsos guardam versões fora das pastas cadastradas. Para publicar na pasta de uma aplicação, abra seu projeto e escolha Fazer novo build.")}</p>
          <Management
            panel="versions"
            onStarted={onStarted}
            onSessionExpired={onSessionExpired}
            onBusyChange={setBusy}
          />
        </>
      ) : (
        <>
          <div className="project-build-filter">
            <label>
              {t("Projeto")}<select
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
                disabled={busy}
              >
                <option value="">{t("Todos os projetos")}</option>
                {projects.map((project) => (
                  <option key={project._id} value={project._id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
            {projectId && (
              <button
                className="project-button secondary"
                disabled={busy}
                onClick={() => onOpenProject(projectId)}
              >
                {t("Abrir projeto")}</button>
            )}
          </div>
          <BuildHistory
            key={projectId}
            projectId={projectId || undefined}
            onBusyChange={setBusy}
            onPublished={onStarted}
            onSessionExpired={onSessionExpired}
            onOpenProject={onOpenProject}
          />
        </>
      )}
    </div>
  );
}
