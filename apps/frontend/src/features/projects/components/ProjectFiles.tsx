import { t } from "../../../i18n";
import { useEffect, useState } from "react";
import {
  ChevronRight,
  Download,
  FileCode2,
  Folder,
  FolderOpen,
  LockKeyhole,
  RefreshCw,
} from "lucide-react";
import { api, ApiError } from "../../../services/api";
import { dateTime, fileSize, type FileView } from "../types";

export function ProjectFiles({
  projectId,
  revision,
  onSessionExpired,
}: {
  projectId: string;
  revision: number;
  onSessionExpired: () => void;
}) {
  const [path, setPath] = useState("");
  const [view, setView] = useState<FileView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setView(null);
    void api<FileView>(
      `/api/projects/${projectId}/files?path=${encodeURIComponent(path)}`,
      { signal: controller.signal },
    )
      .then((result) => {
        if (!controller.signal.aborted) setView(result);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        if (reason instanceof ApiError && reason.status === 401)
          onSessionExpired();
        setError(
          reason instanceof Error
            ? reason.message
            : t("Não foi possível carregar os arquivos."),
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [projectId, path, revision, refresh, onSessionExpired]);
  const parts = path.split("/").filter(Boolean);
  return (
    <section className="repository-files" aria-label={t("Arquivos do projeto")}>
      <div className="repository-toolbar">
        <nav
          className="repository-breadcrumbs"
          aria-label={t("Caminho dos arquivos")}
        >
          <button onClick={() => setPath("")}>
            <FolderOpen size={16} />
            {t("Raiz")}
          </button>
          {parts.map((part, index) => (
            <span key={index}>
              <ChevronRight size={14} />
              <button
                onClick={() => setPath(parts.slice(0, index + 1).join("/"))}
              >
                {part}
              </button>
            </span>
          ))}
        </nav>
        <button
          className="project-button secondary small"
          onClick={() => setRefresh((value) => value + 1)}
          disabled={loading}
          aria-label={t("Atualizar arquivos")}
        >
          <RefreshCw size={15} />
          {t("Atualizar")}
        </button>
      </div>
      {error && (
        <p role="alert" className="project-message error">
          {error}
        </p>
      )}
      {loading && (
        <p className="project-empty" role="status">
          {t("Carregando arquivos…")}
        </p>
      )}
      {view?.type === "directory" && (
        <>
          <div className="repository-table-scroll">
            <table className="repository-table">
              <thead>
                <tr>
                  <th>{t("Nome")}</th>
                  <th>{t("Modificado em")}</th>
                  <th>{t("Tamanho")}</th>
                </tr>
              </thead>
              <tbody>
                {path && (
                  <tr>
                    <td colSpan={3}>
                      <button
                        className="repository-file"
                        onClick={() => setPath(parts.slice(0, -1).join("/"))}
                      >
                        <Folder size={17} />
                        ..
                      </button>
                    </td>
                  </tr>
                )}
                {view.entries.map((entry) => (
                  <tr key={entry.path}>
                    <td>
                      <button
                        className="repository-file"
                        disabled={entry.type === "blocked"}
                        onClick={() => setPath(entry.path)}
                        title={
                          entry.type === "blocked"
                            ? t(
                                "Links e arquivos especiais não podem ser acessados.",
                              )
                            : entry.name
                        }
                      >
                        {entry.type === "directory" ? (
                          <Folder size={17} />
                        ) : entry.type === "blocked" ? (
                          <LockKeyhole size={17} />
                        ) : (
                          <FileCode2 size={17} />
                        )}
                        <span>{entry.name}</span>
                      </button>
                    </td>
                    <td>
                      {entry.modifiedAt ? dateTime(entry.modifiedAt) : "—"}
                    </td>
                    <td>
                      {entry.type === "file" ? fileSize(entry.size) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!view.entries.length && (
            <div className="project-empty">
              <FolderOpen size={32} />
              <strong>{t("Esta pasta está vazia")}</strong>
              <p>
                {t(
                  "Os arquivos aparecerão aqui após a publicação de um build.",
                )}
              </p>
            </div>
          )}
          {view.truncated && (
            <p className="project-footnote">
              {t("Exibindo as primeiras 2.000 entradas desta pasta.")}
            </p>
          )}
        </>
      )}
      {view?.type === "file" && (
        <div className="repository-preview">
          <div className="repository-toolbar">
            <span>
              {fileSize(view.size)} · {dateTime(view.modifiedAt)}
            </span>
            <a
              className="project-button secondary small"
              href={`/api/projects/${projectId}/files/download?path=${encodeURIComponent(path)}`}
            >
              <Download size={15} />
              {t("Baixar arquivo")}
            </a>
          </div>
          {view.binary ? (
            <p className="project-empty">
              {t(
                "Prévia indisponível para arquivos binários. Use o download para abrir este arquivo.",
              )}
            </p>
          ) : (
            <pre
              tabIndex={0}
              aria-label={t("Conteúdo de {0}", { 0: parts.at(-1) })}
            >
              <code>{view.content || t("(arquivo vazio)")}</code>
            </pre>
          )}
          {view.truncated && (
            <p className="project-footnote">
              {t(
                "Prévia limitada a 256 KB. O download contém o arquivo completo.",
              )}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
