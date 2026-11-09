import { useState } from "react";
import { LoaderCircle, ChevronDown, X } from "lucide-react";
import { t } from "../../../i18n";
import type { BuildPublications } from "../useBuildPublication";

export function BuildProgressPanel({ publication }: { publication: BuildPublications }) {
  const [expanded, setExpanded] = useState(true);
  const running = publication.tasks.filter(task => task.status === "running").length;
  if (!publication.visible.length && !publication.connectionError) return null;
  return <aside className="build-progress-panel" aria-label={t("Publicações em segundo plano")}>
    <button className="build-progress-toggle" aria-expanded={expanded} aria-controls="build-progress-items" onClick={() => setExpanded(value => !value)}>
      {running > 0 && <LoaderCircle size={17} className="build-spinner" aria-hidden="true" />}
      <strong>{t("Publicações")} {running > 0 ? `(${running})` : ""}</strong><ChevronDown size={17} aria-hidden="true" />
    </button>
    {expanded && <div id="build-progress-items" className="build-progress-items">
      {publication.connectionError && <p role="alert" className="project-message error">{publication.connectionError}</p>}
      {publication.visible.map(task => <article key={task.id} className={`build-progress-item ${task.status}`}>
        <div className="project-section-heading"><strong>{task.projectName}</strong>
          {task.status !== "running" && <button aria-label={t("Fechar progresso de {0}", { 0: task.projectName })} onClick={() => publication.dismiss(task.id)}><X size={16} /></button>}
        </div>
        <small>{task.username}</small>
        <p role="status">{t(task.stage)}</p>
        <progress max={100} value={task.percent} aria-label={t("Progresso de {0}", { 0: task.projectName })} title={t("O percentual representa as etapas concluídas da publicação.")} />
        <small>{task.percent}% · {t(({ running: "Em andamento", succeeded: "Concluído", failed: "Falhou", cancelled: "Cancelado" })[task.status])}</small>
        {task.status === "running" && task.canCancel && <button className="project-button secondary small" disabled={!task.cancellable || publication.cancelling.includes(task.id)} onClick={() => void publication.cancel(task)}>{t(publication.cancelling.includes(task.id) ? "Cancelando…" : "Cancelar build")}</button>}
        {task.logs.length > 0 && <details open={task.status === "failed"}><summary>{t("Log da publicação")}</summary><pre>{task.logs.map(line => t(line)).join("\n")}</pre></details>}
      </article>)}
    </div>}
  </aside>;
}
