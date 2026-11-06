import { t } from "../../../i18n";
import { useState, type FormEvent } from "react";
import { Upload } from "lucide-react";
import { archiveAccept, fileSize, type Project } from "../types";

export function BuildForm({
  project,
  busy,
  onSubmit,
  onCancel,
}: {
  project: Project;
  busy: boolean;
  onSubmit: (data: FormData) => Promise<void>;
  onCancel: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const now = new Date();
  const suggested = `build-${String(now.getDate()).padStart(2, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}-v${project.nextBuildNumber + 1}`;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSubmit(new FormData(event.currentTarget));
  }
  return (
    <section className="project-form-card" aria-labelledby="new-build-title">
      <div className="project-section-heading">
        <div>
          <h2 id="new-build-title">
            {t("Novo build de")} {project.name}
          </h2>
          <p>
            {t("Envie o pacote pronto e registre as alterações desta versão.")}
          </p>
        </div>
      </div>
      <form className="project-form" onSubmit={submit}>
        <label>
          {t("Nome do build")}
          <input
            name="name"
            defaultValue={suggested}
            required
            maxLength={80}
            pattern="[a-zA-Z0-9][a-zA-Z0-9._\-]*"
            disabled={busy}
            autoFocus
          />
        </label>
        <label>
          {t("O que mudou neste build?")}
          <textarea
            name="comments"
            required
            maxLength={4000}
            rows={3}
            placeholder={t(
              "Descreva correções, melhorias e mudanças desta versão.",
            )}
            disabled={busy}
          />
        </label>
        <label className="project-upload">
          <span>
            <Upload size={20} />
            {t("Pacote do build")}
          </span>
          <input
            name="build"
            type="file"
            accept={archiveAccept}
            required
            disabled={busy}
            onChange={(event) => setFile(event.target.files?.[0] || null)}
          />
          <small>
            {file
              ? `${file.name} · ${fileSize(file.size)}`
              : t("ZIP, RAR, 7z, TAR, TAR.GZ, TAR.BZ2 ou TAR.XZ.")}
          </small>
        </label>
        <p className="project-form-note">
          {t("Ao publicar, os arquivos serão aplicados em")}{" "}
          <code>{project.rootPath}</code>{" "}
          {t("e a aplicação será iniciada ou atualizada com")}{" "}
          <code>{project.pm2ConfigPath}</code>
          {t(". Inclua as dependências necessárias no pacote.")}
        </p>
        <p className="project-form-note">
          {project.pm2ConfigContent
            ? t(
                "O ZIP pode conter somente os arquivos da aplicação. Se não houver ecosystem, a configuração salva no projeto será copiada para este build.",
              )
            : t(
                "Se o ZIP não incluir o ecosystem, salve a configuração em Editar projeto ou mantenha o arquivo na pasta da VM.",
              )}
        </p>
        <div className="project-form-actions">
          <button
            type="button"
            className="project-button secondary"
            onClick={onCancel}
            disabled={busy}
          >
            {t("Cancelar")}
          </button>
          <button className="project-button" disabled={busy}>
            <Upload size={16} />
            {busy ? t("Extraindo e publicando…") : t("Enviar e publicar")}
          </button>
        </div>
      </form>
    </section>
  );
}
