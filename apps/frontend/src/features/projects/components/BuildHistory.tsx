import { t } from "../../../i18n";
import { useEffect, useState } from "react";
import { Download, Package, Play, RefreshCw } from "lucide-react";
import { api, ApiError } from "../../../services/api";
import {
  dateTime,
  fileSize,
  type BuildPage,
  type ProjectBuild,
} from "../types";

const states = {
  processing: "Extraindo",
  ready: "Pronto",
  deploying: "Publicando",
  deployed: "Publicado",
  failed: "Falhou",
  deleting: "Excluindo",
};

export function BuildHistory({
  projectId,
  revision = 0,
  disabled = false,
  onBusyChange,
  onPublished,
  onSessionExpired,
  onOpenProject,
}: {
  projectId?: string;
  revision?: number;
  disabled?: boolean;
  onBusyChange: (busy: boolean) => void;
  onPublished: () => Promise<void>;
  onSessionExpired: () => void;
  onOpenProject?: (id: string) => void;
}) {
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<BuildPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    onBusyChange(Boolean(busy));
  }, [busy, onBusyChange]);
  useEffect(() => () => onBusyChange(false), [onBusyChange]);
  useEffect(() => {
    setPage(1);
  }, [projectId, revision]);
  useEffect(() => {
    const controller = new AbortController();
    const url = projectId
      ? `/api/projects/${projectId}/builds?page=${page}`
      : `/api/builds?page=${page}`;
    setLoading(true);
    void api<BuildPage>(url, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setResult(data);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        if (reason instanceof ApiError && reason.status === 401)
          onSessionExpired();
        setError(
          reason instanceof Error
            ? reason.message
            : t("Não foi possível carregar os builds."),
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [projectId, page, revision, refresh, onSessionExpired]);

  async function publish(build: ProjectBuild) {
    setBusy(build._id);
    setError("");
    setNotice("");
    try {
      await api(`/api/projects/${build.projectId}/builds/${build._id}/deploy`, {
        method: "POST",
      });
      setNotice(
        t("{0} publicado. A aplicação foi enviada ao PM2.", { 0: build.name }),
      );
      await onPublished();
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401)
        onSessionExpired();
      setError(
        reason instanceof Error
          ? reason.message
          : t("Falha ao publicar o build."),
      );
    } finally {
      setBusy(null);
      setRefresh((value) => value + 1);
    }
  }
  const locked = disabled || Boolean(busy);
  return (
    <section className="build-history" aria-label={t("Histórico de builds")}>
      <div className="project-section-heading">
        <div>
          <h2>{t("Histórico de builds")}</h2>
          <p>
            {result?.total ?? 0} {t("builds registrados")}
            {projectId ? ` ${t("neste projeto")}` : ""}
          </p>
        </div>
        <button
          className="project-button secondary small"
          onClick={() => {
            setError("");
            setRefresh((value) => value + 1);
          }}
          disabled={loading || locked}
        >
          <RefreshCw size={15} />
          {t("Atualizar builds")}
        </button>
      </div>
      {error && (
        <p className="project-message error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="project-message success" role="status">
          {notice}
        </p>
      )}
      {busy && (
        <p className="project-message" role="status">
          {t("Publicando build e atualizando a aplicação no PM2…")}
        </p>
      )}
      {loading && !result && (
        <p className="project-empty" role="status">
          {t("Carregando builds…")}
        </p>
      )}
      {result && (
        <>
          <div className="repository-table-scroll">
            <table
              className="repository-table builds-table"
              aria-busy={loading}
            >
              <thead>
                <tr>
                  <th>{t("Build / alterações")}</th>
                  <th>{t("Autor e data")}</th>
                  <th>{t("Estado")}</th>
                  <th>{t("Ações")}</th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((build) => (
                  <tr key={build._id}>
                    <td>
                      <div className="build-title">
                        <Package size={16} />
                        <strong>{build.name}</strong>
                        <span>#{build.number}</span>
                      </div>
                      {!projectId && (
                        <button
                          className="project-text-link"
                          onClick={() => onOpenProject?.(build.projectId)}
                          disabled={locked}
                        >
                          {build.projectName}
                        </button>
                      )}
                      <p className="build-comments">{build.comments}</p>
                      <small>
                        {build.originalName} · {fileSize(build.size)}
                      </small>
                      {build.error && (
                        <p className="build-error">{build.error}</p>
                      )}
                    </td>
                    <td>
                      <strong>{build.createdBy}</strong>
                      <time>{dateTime(build.createdAt)}</time>
                      {build.deployedAt && (
                        <small>
                          {t("Publicado por")} {build.deployedBy}
                          <br />
                          {dateTime(build.deployedAt)}
                        </small>
                      )}
                    </td>
                    <td>
                      <span className={`build-status ${build.status}`}>
                        {t(states[build.status])}
                      </span>
                      {build.active && build.status === "deployed" && (
                        <small className="build-active">
                          {t("Última publicação")}
                        </small>
                      )}
                    </td>
                    <td>
                      <div className="build-actions">
                        {build.archiveReady && (
                          <a
                            className="project-button secondary small"
                            href={`/api/projects/${build.projectId}/builds/${build._id}/archive`}
                            aria-label={t("Baixar {0}", { 0: build.name })}
                          >
                            <Download size={15} />
                            {t("Pacote")}
                          </a>
                        )}
                        <button
                          className="project-button secondary small"
                          disabled={
                            locked ||
                            !build.extracted ||
                            ["processing", "deploying"].includes(build.status)
                          }
                          onClick={() => void publish(build)}
                          aria-label={t("Publicar {0}", { 0: build.name })}
                        >
                          <Play size={14} />
                          {busy === build._id
                            ? t("Publicando…")
                            : build.status === "deployed"
                              ? t("Republicar")
                              : t("Publicar")}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!result.items.length && (
            <div className="project-empty">
              <Package size={32} />
              <strong>{t("Nenhum build registrado")}</strong>
              <p>
                {t(
                  "Abra um projeto e escolha Fazer novo build para publicar a primeira versão.",
                )}
              </p>
            </div>
          )}
          {result.total > result.pageSize && (
            <div className="project-pagination">
              <button
                className="project-button secondary small"
                disabled={page <= 1 || loading || locked}
                onClick={() => setPage((value) => value - 1)}
              >
                {t("Anterior")}
              </button>
              <span>
                {t("Página")} {page} {t("de")}{" "}
                {Math.ceil(result.total / result.pageSize)}
              </span>
              <button
                className="project-button secondary small"
                disabled={
                  page * result.pageSize >= result.total || loading || locked
                }
                onClick={() => setPage((value) => value + 1)}
              >
                {t("Próxima")}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
