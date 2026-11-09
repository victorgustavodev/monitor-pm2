import { useState, type FormEvent } from "react";
import { t } from "../../../i18n";
import {
  dateTime,
  type Project,
  type ProjectDeletionPreview,
  type ProjectDeletionOptions,
} from "../types";

export function ProjectSettings({
  project,
  busy,
  onSave,
  onPrepareDelete,
  onDelete,
}: {
  project: Project;
  busy: boolean;
  onSave: (data: FormData) => Promise<void>;
  onPrepareDelete: () => Promise<ProjectDeletionPreview>;
  onDelete: (options: ProjectDeletionOptions) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [preview, setPreview] = useState<ProjectDeletionPreview | null>(null);
  const [stopProcesses, setStopProcesses] = useState(false);
  const locked = busy || project.deploying;
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!locked) await onSave(new FormData(event.currentTarget));
  }
  async function remove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!busy && confirmation === project.name && preview)
      await onDelete({ stopProcesses, processRevision: preview.revision });
  }
  async function beginDelete() {
    setStopProcesses(false);
    setConfirmation("");
    setPreview(null);
    try {
      setPreview(await onPrepareDelete());
      setConfirming(true);
    } catch {
      /* The project screen displays the error. */
    }
  }
  return (
    <section className="project-form-card project-details">
      <h2>{t("Configuração do projeto")}</h2>
      <form className="project-form" onSubmit={save}>
        <div className="project-form-columns">
          <label>
            {t("Nome do projeto")}
            <input
              name="name"
              defaultValue={project.name}
              required
              maxLength={80}
              disabled={locked}
            />
          </label>
          <label>
            {t("Descrição")}
            <input
              name="description"
              defaultValue={project.description}
              maxLength={500}
              disabled={locked}
            />
          </label>
        </div>
        <label>
          {t("Pasta principal na VM")}
          <input
            name="rootPath"
            defaultValue={project.rootPath}
            required
            maxLength={1024}
            disabled={locked}
          />
          <small>
            {t(
              "Alterar a pasta não move arquivos nem reinicia processos. A próxima publicação usará o novo destino.",
            )}
          </small>
        </label>
        <label>
          {t("Arquivo de configuração do PM2")}
          <input
            name="pm2ConfigPath"
            defaultValue={project.pm2ConfigPath}
            required
            maxLength={1024}
            disabled={locked}
          />
          <small>
            {t(
              "Caminho relativo à pasta principal. Exemplo: config/ecosystem.config.js.",
            )}
          </small>
        </label>
        <div className="project-form-actions">
          <button className="project-button" disabled={locked}>
            {busy ? t("Salvando…") : t("Salvar alterações")}
          </button>
        </div>
      </form>
      <dl>
        <div>
          <dt>{t("Executar PM2 com")}</dt>
          <dd>
            <code>{project.pathToRunPm2}</code>
          </dd>
        </div>
        <div>
          <dt>{t("Criado por")}</dt>
          <dd>{project.createdBy}</dd>
        </div>
        <div>
          <dt>{t("Data de criação")}</dt>
          <dd>{dateTime(project.createdAt)}</dd>
        </div>
        <div>
          <dt>{t("Builds registrados")}</dt>
          <dd>{project.buildCount}</dd>
        </div>
      </dl>
      <div className="project-delete-section">
        <h2>{t("Excluir projeto")}</h2>
        <p className="project-form-note">
          {t(
            "A exclusão remove permanentemente o cadastro, o histórico e os pacotes dos builds. A pasta da aplicação na VM é preservada. Você pode escolher encerrar os processos vinculados na confirmação.",
          )}
        </p>
        {project.deleting && (
          <p role="status" className="project-message error">
            {t(
              "A exclusão deste projeto está pendente. Tente excluir novamente.",
            )}
          </p>
        )}
        {!confirming ? (
          <button
            className="project-button danger"
            disabled={busy || (project.deploying && !project.deleting)}
            onClick={() => void beginDelete()}
          >
            {t("Excluir projeto")}
          </button>
        ) : (
          <form className="project-form" onSubmit={remove}>
            {preview && preview.processes.length > 0 ? (
              <div className="project-linked-processes">
                <strong>{t("Processos vinculados ao projeto")}</strong>
                <ul>
                  {preview.processes.map((process) => (
                    <li key={process.id}>
                      {process.name} · ID {process.id} · {process.status}
                    </li>
                  ))}
                </ul>
                <label className="project-stop-processes">
                  <input
                    name="stopProcesses"
                    type="checkbox"
                    checked={stopProcesses}
                    disabled={busy}
                    onChange={(event) => setStopProcesses(event.target.checked)}
                  />
                  <span>
                    {t(
                      "Encerrar também os processos vinculados (parar no PM2)",
                    )}
                  </span>
                </label>
                <p className="project-form-note">
                  {t(
                    "Desmarcado: os processos continuam como estão. Marcado: os processos serão parados, mantendo seus registros no PM2.",
                  )}
                </p>
              </div>
            ) : (
              <p className="project-form-note">
                {t("Nenhum processo vinculado foi encontrado no PM2.")}
              </p>
            )}
            <label>
              {t("Digite {0} para confirmar a exclusão", { 0: project.name })}
              <input
                name="deleteConfirmation"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="off"
                disabled={busy}
                required
                autoFocus
              />
            </label>
            <div className="project-form-actions">
              <button
                type="button"
                className="project-button secondary"
                disabled={busy}
                onClick={() => {
                  setConfirming(false);
                  setConfirmation("");
                }}
              >
                {t("Cancelar")}
              </button>
              <button
                className="project-button danger"
                disabled={busy || confirmation !== project.name}
              >
                {busy ? t("Excluindo…") : t("Confirmar exclusão")}
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
