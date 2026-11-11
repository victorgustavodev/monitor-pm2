import type { BuildPublications } from "./useBuildPublication";
import type { Process } from "../processes/processes";
import { t } from "../../i18n";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  BookOpen,
  Code2,
  FolderGit2,
  FolderOpen,
  Package,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Upload,
} from "lucide-react";
import { api, ApiError } from "../../services/api";
import { BuildForm } from "./components/BuildForm";
import { BuildHistory } from "./components/BuildHistory";
import { ProjectFiles } from "./components/ProjectFiles";
import type {
  Project,
  ProjectDeletionPreview,
  ProjectDeletionOptions,
} from "./types";
import { ProjectSettings } from "./components/ProjectSettings";
import { ProjectEnvironment } from "./components/ProjectEnvironment";
import { ProjectDocumentation } from "./components/ProjectDocumentation";

export function Projects({
  projectId,
  onSelectProject,
  onStarted,
  onSessionExpired,
  onBusyChange,
  publication,
  processes,
  processesConnected,
}: {
  projectId: string | null;
  onSelectProject: (id: string | null) => void;
  onStarted: () => Promise<void>;
  onSessionExpired: () => void;
  onBusyChange: (busy: boolean) => void;
  publication: BuildPublications;
  processes: Process[];
  processesConnected: boolean;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [formBusy, setFormBusy] = useState(false);
  const [deployBusy, setDeployBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showBuild, setShowBuild] = useState(false);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"files" | "builds" | "about" | "environment" | "settings">("files");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const starting = useRef(false);
  const [startingId, setStartingId] = useState<string | null>(null);
  const busy = formBusy || deployBusy;
  const selected = projects.find((project) => project._id === projectId);
  const projectLocked = Boolean(selected && (selected.deploying || publication.isProjectBusy(selected._id)));
  const fail = useCallback(
    (reason: unknown) => {
      if (reason instanceof ApiError && reason.status === 401)
        onSessionExpired();
      setError(
        reason instanceof Error
          ? reason.message
          : t("Não foi possível concluir a operação."),
      );
    },
    [onSessionExpired],
  );
  const load = useCallback(async () => {
    setProjects(await api<Project[]>("/api/projects"));
  }, []);
  useEffect(() => {
    void load()
      .catch(fail)
      .finally(() => setLoading(false));
  }, [load, fail]);
  useEffect(() => {
    if (publication.revision) void load().catch(fail);
  }, [publication.revision, load, fail]);
  useEffect(() => {
    onBusyChange(busy);
  }, [busy, onBusyChange]);
  useEffect(() => () => onBusyChange(false), [onBusyChange]);
  useEffect(() => {
    setTab("files");
    setShowBuild(false);
    setError("");
    setNotice("");
  }, [projectId]);
  const published = useCallback(async () => {
    await load();
    setRevision((value) => value + 1);
    await onStarted();
  }, [load, onStarted]);

  async function start(project: Project) {
    if (starting.current || busy || publication.processesLocked || project.deploying) return;
    starting.current = true;
    setStartingId(project._id); setFormBusy(true); setError(""); setNotice("");
    try {
      await api(`/api/projects/${project._id}/start`, { method: "POST" });
      setNotice(t("Aplicações iniciadas com os arquivos locais."));
    } catch (reason) { fail(reason); }
    finally {
      await onStarted();
      starting.current = false; setStartingId(null); setFormBusy(false);
    }
  }
  function runtime(project: Project) {
    const linked = processes.filter(process => process.projectId === project._id);
    const online = linked.filter(process => process.status === "online").length;
    return <div className="flex flex-wrap items-center gap-3 py-3">
      <span className="text-sm text-muted">{!processesConnected ? t("Estado do PM2 indisponível") : online && online === linked.length ? t("Aplicações em execução") : online ? t("Há aplicações não iniciadas") : t("Não iniciada")}</span>
      {(!processesConnected || !linked.length || online < linked.length) && <button className="project-button secondary"
        disabled={busy || publication.processesLocked || project.deploying}
        onClick={() => void start(project)}>{t(startingId === project._id ? "Iniciando…" : "Iniciar sem build")}</button>}
      {project.applicationUrl && <a className="project-text-link" href={project.applicationUrl} target="_blank" rel="noopener noreferrer">{t("Abrir aplicação")}</a>}
    </div>;
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setFormBusy(true);
    setError("");
    setNotice("");
    try {
      const project = await api<Project>("/api/projects", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(data.entries())),
      });
      await load();
      setCreating(false);
      onSelectProject(project._id);
      await onStarted();
    } catch (reason) {
      fail(reason);
    } finally {
      setFormBusy(false);
    }
  }
  async function upload(data: FormData) {
    if (!selected) return;
    setFormBusy(true);
    setError("");
    setNotice("");
    try {
      await publication.run(selected._id, `/api/projects/${selected._id}/builds`, data, selected.name);
      setShowBuild(false);
      setNotice(t("Publicação iniciada em segundo plano. Acompanhe o progresso no canto superior."));
    } catch (reason) {
      await load().catch(() => undefined);
      fail(reason);
      setRevision((value) => value + 1);
    } finally {
      setFormBusy(false);
    }
  }
  async function refresh() {
    setLoading(true);
    setError("");
    try {
      await load();
      await onStarted();
      setRevision((value) => value + 1);
    } catch (reason) {
      fail(reason);
    } finally {
      setLoading(false);
    }
  }
  async function update(data: FormData) {
    if (!selected || busy) return;
    setFormBusy(true);
    setError("");
    setNotice("");
    try {
      const project = await api<Project>(`/api/projects/${selected._id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: selected.name,
          description: selected.description,
          rootPath: selected.rootPath,
          pm2ConfigPath: selected.pm2ConfigPath,
          ...Object.fromEntries(data.entries()),
        }),
      });
      setProjects((rows) =>
        rows.map((row) => (row._id === project._id ? project : row)),
      );
      setRevision((value) => value + 1);
      setNotice(t("Projeto atualizado."));
      await onStarted();
    } catch (reason) {
      fail(reason);
    } finally {
      setFormBusy(false);
    }
  }
  async function prepareDelete() {
    if (!selected) throw new Error(t("Projeto não encontrado."));
    setFormBusy(true);
    setError("");
    setNotice("");
    try {
      return await api<ProjectDeletionPreview>(
        `/api/projects/${selected._id}/deletion-preview`,
      );
    } catch (reason) {
      fail(reason);
      throw reason;
    } finally {
      setFormBusy(false);
    }
  }
  async function remove(options: ProjectDeletionOptions) {
    if (!selected || busy) return;
    setFormBusy(true);
    setError("");
    setNotice("");
    try {
      await api(`/api/projects/${selected._id}`, {
        method: "DELETE",
        body: JSON.stringify(options),
      });
      setProjects((rows) => rows.filter((row) => row._id !== selected._id));
      onSelectProject(null);
      await onStarted();
    } catch (reason) {
      await load().catch(() => undefined);
      fail(reason);
    } finally {
      setFormBusy(false);
    }
  }
  const filtered = projects.filter((project) =>
    `${project.name} ${project.description}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <div className="projects-content">
      {error && (
        <p role="alert" className="project-message error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="project-message success">
          {notice}
        </p>
      )}
      {!projectId && (
        <>
          <div className="project-list-toolbar">
            <label className="project-search">
              <Search size={18} />
              <input
                aria-label={t("Buscar projeto")}
                placeholder={t("Buscar projeto…")}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                disabled={busy}
              />
            </label>
            <button
              className="project-button secondary"
              onClick={() => void refresh()}
              disabled={busy || loading}
            >
              <RefreshCw size={16} />
              {t("Atualizar")}
            </button>
            <button
              className="project-button"
              onClick={() => {
                setCreating(true);
                setError("");
              }}
              disabled={busy || creating}
            >
              <Plus size={17} />
              {t("Novo projeto")}
            </button>
          </div>
          {creating && (
            <section
              className="project-form-card"
              aria-labelledby="new-project-title"
            >
              <div className="project-section-heading">
                <div>
                  <h2 id="new-project-title">{t("Criar projeto")}</h2>
                  <p>
                    {t(
                      "Cadastre a pasta da aplicação nesta VM e o arquivo usado pelo PM2.",
                    )}
                  </p>
                </div>
              </div>
              <form className="project-form" onSubmit={create}>
                <div className="project-form-columns">
                  <label>
                    {t("Nome do projeto")}
                    <input
                      name="name"
                      placeholder="project-name"
                      required
                      maxLength={80}
                      disabled={busy}
                      autoFocus
                    />
                  </label>
                  <label>
                    {t("Descrição")}
                    <input
                      name="description"
                      placeholder={t("O que esta aplicação faz?")}
                      maxLength={500}
                      disabled={busy}
                    />
                  </label>
                </div>
                <label>
                  {t("Link da aplicação")}
                  <input name="applicationUrl" type="url" placeholder="https://app.exemplo.com" maxLength={2048} disabled={busy} />
                </label>
                <label>
                  {t("Pasta principal na VM")}
                  <input
                    name="rootPath"
                    placeholder="C:\servicos\project-name"
                    required
                    maxLength={1024}
                    disabled={busy}
                  />
                  <small>
                    {t(
                      "Use uma pasta dedicada à aplicação. Ela será criada se ainda não existir.",
                    )}
                  </small>
                </label>
                <label>
                  {t("Arquivo de configuração do PM2")}
                  <input
                    name="pm2ConfigPath"
                    defaultValue="ecosystem.config.js"
                    required
                    maxLength={1024}
                    disabled={busy}
                  />
                  <small>
                    {t(
                      "Caminho relativo à pasta principal. Exemplo: config/ecosystem.config.js.",
                    )}
                  </small>
                </label>
                <div className="project-form-actions">
                  <button
                    type="button"
                    className="project-button secondary"
                    onClick={() => setCreating(false)}
                    disabled={busy}
                  >
                    {t("Cancelar")}
                  </button>
                  <button className="project-button" disabled={busy}>
                    {formBusy ? t("Criando…") : t("Criar projeto")}
                  </button>
                </div>
              </form>
            </section>
          )}
          <div className="project-list-caption">
            <span>
              {filtered.length}{" "}
              {t(filtered.length === 1 ? "projeto" : "projetos")}
            </span>
            <span>{t("Arquivos e publicações na VM")}</span>
          </div>
          {loading && !projects.length ? (
            <p role="status" className="project-empty">
              {t("Carregando projetos…")}
            </p>
          ) : (
            <div className="project-grid">
              {filtered.map((project) => (
                <article className="project-card" key={project._id}>
                  <div className="project-card-title">
                    <FolderGit2 size={23} />
                    <button
                      disabled={busy}
                      onClick={() => onSelectProject(project._id)}
                    >
                      {project.name}
                    </button>
                    <span className="project-location-tag">{t("Local")}</span>
                  </div>
                  <p className="project-card-description">
                    {project.description ||
                      t("Arquivos e histórico de builds da aplicação.")}
                  </p>
                  <p className="project-card-path" title={project.rootPath}>
                    <FolderOpen size={15} />
                    {project.rootPath}
                  </p>
                  {runtime(project)}
                  <div className="project-card-footer">
                    <span>
                      <Package size={15} />
                      {project.buildCount} {t("builds")}
                    </span>
                    <span>
                      {t("por")} {project.createdBy}
                    </span>
                    <button
                      className="project-text-link"
                      disabled={busy}
                      onClick={() => onSelectProject(project._id)}
                    >
                      {t("Abrir projeto")}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
          {!loading && !filtered.length && (
            <div className="project-empty project-form-card">
              <FolderGit2 size={36} />
              <strong>
                {query
                  ? t("Nenhum projeto encontrado")
                  : t("Seu primeiro projeto começa aqui")}
              </strong>
              <p>
                {query
                  ? t("Tente buscar por outro nome.")
                  : t(
                      "Cadastre a pasta de uma aplicação para navegar pelos arquivos e publicar builds.",
                    )}
              </p>
            </div>
          )}
        </>
      )}
      {projectId && !selected && !loading && (
        <div className="project-empty">
          <p>{t("Projeto não encontrado.")}</p>
          <button
            className="project-button secondary"
            onClick={() => onSelectProject(null)}
          >
            {t("Voltar aos projetos")}
          </button>
        </div>
      )}
      {selected && (
        <>
          <button
            className="project-back"
            onClick={() => onSelectProject(null)}
            disabled={busy}
          >
            <ArrowLeft size={16} />
            {t("Todos os projetos")}
          </button>
          <section className="repository-header">
            <div className="repository-identity">
              <FolderGit2 size={28} />
              <div>
                <h2>{selected.name}</h2>
                <p>
                  {selected.description || t("Arquivos e builds da aplicação")}
                </p>
              </div>
              <span className="project-location-tag">{t("Local")}</span>
            </div>
            <div className="project-header-actions">
              <button
                className="project-button secondary"
                disabled={busy || projectLocked}
                onClick={() => {
                  setTab("settings");
                  setShowBuild(false);
                  setError("");
                  setNotice("");
                }}
              >
                {t("Editar projeto")}
              </button>
              <button
                className="project-button"
                onClick={() => {
                  setTab("builds");
                  setShowBuild(true);
                  setError("");
                  setNotice("");
                }}
                disabled={busy || projectLocked}
              >
                <Upload size={17} />
                {t("Fazer novo build")}
              </button>
            </div>
            <p className="repository-location">
              <FolderOpen size={15} />
              <code>{selected.rootPath}</code>
            </p>
            {runtime(selected)}
            <p className="text-sm text-muted">{t("Iniciar sem build executa o ecosystem existente na pasta do projeto.")}</p>
          </section>
          {selected.deploymentError && (
            <p className="project-message error" role="status">
              {selected.deploymentError}
            </p>
          )}
          {projectLocked && <p className="project-message" role="status">{t("Este projeto está publicando. Novos builds e alterações ficam bloqueados até a conclusão.")}</p>}
          <div
            className="repository-tabs"
            role="tablist"
            aria-label={t("Áreas do projeto")}
          >
            {(
              [
                { id: "files", label: t("Arquivos"), Icon: Code2 },
                {
                  id: "builds",
                  label: `Builds (${selected.buildCount})`,
                  Icon: Package,
                },
                { id: "about", label: t("Sobre o projeto"), Icon: BookOpen },
                { id: "environment", label: t("Variáveis de ambiente"), Icon: Code2 },
                { id: "settings", label: t("Configuração do projeto"), Icon: Settings },
              ] as const
            ).map(({ id, label, Icon }) => (
              <button
                key={id}
                id={`project-tab-${id}`}
                role="tab"
                aria-selected={tab === id}
                aria-controls="project-tab-panel"
                disabled={busy}
                onClick={() => setTab(id)}
              >
                <Icon size={17} />
                {label}
              </button>
            ))}
          </div>
          <div
            id="project-tab-panel"
            role="tabpanel"
            aria-labelledby={`project-tab-${tab}`}
          >
            {tab === "files" && (
              <ProjectFiles
                key={selected._id}
                projectId={selected._id}
                revision={revision}
                onSessionExpired={onSessionExpired}
              />
            )}
            {tab === "builds" && (
              <>
                {showBuild && (
                  <BuildForm
                    key={selected._id}
                    project={selected}
                    busy={busy || projectLocked}
                    onSubmit={upload}
                    onCancel={() => setShowBuild(false)}
                  />
                )}
                {formBusy && (
                  <p role="status" className="project-message">
                    {t(
                      "Recebendo o pacote, validando os arquivos e publicando a aplicação…",
                    )}
                  </p>
                )}
                <BuildHistory
                  projectId={selected._id}
                  revision={revision}
                  disabled={formBusy || projectLocked}
                  publication={publication}
                  projectName={selected.name}
                  onBusyChange={setDeployBusy}
                  onPublished={published}
                  onSessionExpired={onSessionExpired}
                />
              </>
            )}
            {tab === "settings" && (
              <ProjectSettings
                key={`${selected._id}:${selected.updatedAt}`}
                project={selected}
                busy={busy || projectLocked}
                onSave={update}
                onPrepareDelete={prepareDelete}
                onDelete={remove}
              />
            )}
            {tab === "about" && (
              <ProjectDocumentation
                key={`${selected._id}:${selected.updatedAt}`}
                project={selected}
                busy={busy || projectLocked}
                onSave={update}
              />
            )}
            {tab === "environment" && (
              <ProjectEnvironment
                key={selected._id}
                project={selected}
                busy={busy || projectLocked}
                onSave={update}
                onBusyChange={setFormBusy}
                onSessionExpired={onSessionExpired}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
