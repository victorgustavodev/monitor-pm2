import { t } from "../../i18n";
import { useCallback, useEffect, useState, type FormEvent } from "react";
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
  Upload,
} from "lucide-react";
import { api, ApiError } from "../../services/api";
import { BuildForm } from "./components/BuildForm";
import { BuildHistory } from "./components/BuildHistory";
import { ProjectFiles } from "./components/ProjectFiles";
import { dateTime, type Project } from "./types";

export function Projects({
  projectId,
  onSelectProject,
  onStarted,
  onSessionExpired,
  onBusyChange,
}: {
  projectId: string | null;
  onSelectProject: (id: string | null) => void;
  onStarted: () => Promise<void>;
  onSessionExpired: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [formBusy, setFormBusy] = useState(false);
  const [deployBusy, setDeployBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showBuild, setShowBuild] = useState(false);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"files" | "builds" | "settings">("files");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const busy = formBusy || deployBusy;
  const selected = projects.find((project) => project._id === projectId);
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
      await api(`/api/projects/${selected._id}/builds`, {
        method: "POST",
        body: data,
      });
      setShowBuild(false);
      setNotice(t("Build publicado. A aplicação foi enviada ao PM2."));
      await published();
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
      setRevision((value) => value + 1);
    } catch (reason) {
      fail(reason);
    } finally {
      setLoading(false);
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
              {t("Atualizar")}</button>
            <button
              className="project-button"
              onClick={() => {
                setCreating(true);
                setError("");
              }}
              disabled={busy || creating}
            >
              <Plus size={17} />
              {t("Novo projeto")}</button>
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
                    {t("Cadastre a pasta da aplicação nesta VM e o arquivo usado pelo PM2.")}</p>
                </div>
              </div>
              <form className="project-form" onSubmit={create}>
                <div className="project-form-columns">
                  <label>
                    {t("Nome do projeto")}<input
                      name="name"
                      placeholder="ProjetoX"
                      required
                      maxLength={80}
                      disabled={busy}
                      autoFocus
                    />
                  </label>
                  <label>
                    {t("Descrição")}<input
                      name="description"
                      placeholder={t("O que esta aplicação faz?")}
                      maxLength={500}
                      disabled={busy}
                    />
                  </label>
                </div>
                <label>
                  {t("Pasta principal na VM")}<input
                    name="rootPath"
                    placeholder="C:\servicos\ProjetoX"
                    required
                    maxLength={1024}
                    disabled={busy}
                  />
                  <small>
                    {t("Use uma pasta dedicada à aplicação. Ela será criada se ainda não existir.")}</small>
                </label>
                <label>
                  {t("Arquivo de configuração do PM2")}<input
                    name="pm2ConfigPath"
                    defaultValue="ecosystem.config.js"
                    required
                    maxLength={1024}
                    disabled={busy}
                  />
                  <small>
                    {t("Caminho relativo à pasta principal. Exemplo: config/ecosystem.config.js.")}</small>
                </label>
                <div className="project-form-actions">
                  <button
                    type="button"
                    className="project-button secondary"
                    onClick={() => setCreating(false)}
                    disabled={busy}
                  >
                    {t("Cancelar")}</button>
                  <button className="project-button" disabled={busy}>
                    {formBusy ? t("Criando…") : t("Criar projeto")}
                  </button>
                </div>
              </form>
            </section>
          )}
          <div className="project-list-caption">
            <span>
              {filtered.length} {t(filtered.length === 1 ? 'projeto' : 'projetos')}
            </span>
            <span>{t("Arquivos e publicações na VM")}</span>
          </div>
          {loading && !projects.length ? (
            <p role="status" className="project-empty">
              {t("Carregando projetos…")}</p>
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
                  <div className="project-card-footer">
                    <span>
                      <Package size={15} />
                      {project.buildCount} {t("builds")}</span>
                    <span>{t("por")}{" "}{project.createdBy}</span>
                    <button
                      className="project-text-link"
                      disabled={busy}
                      onClick={() => onSelectProject(project._id)}
                    >
                      {t("Abrir projeto")}</button>
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
                  : t("Cadastre a pasta de uma aplicação para navegar pelos arquivos e publicar builds.")}
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
            {t("Voltar aos projetos")}</button>
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
            {t("Todos os projetos")}</button>
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
            <button
              className="project-button"
              onClick={() => {
                setTab("builds");
                setShowBuild(true);
                setError("");
                setNotice("");
              }}
              disabled={busy || selected.deploying}
            >
              <Upload size={17} />
              {t("Fazer novo build")}</button>
            <p className="repository-location">
              <FolderOpen size={15} />
              <code>{selected.rootPath}</code>
            </p>
          </section>
          {selected.deploymentError && (
            <p className="project-message error" role="status">
              {selected.deploymentError}
            </p>
          )}
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
                { id: "settings", label: t("Sobre o projeto"), Icon: BookOpen },
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
                    busy={busy}
                    onSubmit={upload}
                    onCancel={() => setShowBuild(false)}
                  />
                )}
                {formBusy && (
                  <p role="status" className="project-message">
                    {t("Recebendo o pacote, validando os arquivos e publicando a aplicação…")}</p>
                )}
                <BuildHistory
                  projectId={selected._id}
                  revision={revision}
                  disabled={formBusy || selected.deploying}
                  onBusyChange={setDeployBusy}
                  onPublished={published}
                  onSessionExpired={onSessionExpired}
                />
              </>
            )}
            {tab === "settings" && (
              <section className="project-form-card project-details">
                <h2>{t("Configuração do projeto")}</h2>
                <dl>
                  <div>
                    <dt>{t("Pasta principal")}</dt>
                    <dd>
                      <code>{selected.rootPath}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>{t("Executar PM2 com")}</dt>
                    <dd>
                      <code>{selected.pathToRunPm2}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>{t("Criado por")}</dt>
                    <dd>{selected.createdBy}</dd>
                  </div>
                  <div>
                    <dt>{t("Data de criação")}</dt>
                    <dd>{dateTime(selected.createdAt)}</dd>
                  </div>
                  <div>
                    <dt>{t("Builds registrados")}</dt>
                    <dd>{selected.buildCount}</dd>
                  </div>
                </dl>
                <p className="project-form-note">
                  {t("Cada build guarda seu pacote original e comentário. Você pode publicar uma versão anterior pelo histórico. O monitor publica pacotes prontos; inclua os arquivos e dependências necessários para executar a aplicação.")}</p>
              </section>
            )}
          </div>
        </>
      )}
    </div>
  );
}
