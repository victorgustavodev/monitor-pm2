import { useEffect, useRef } from "react";
import { t } from "../../../i18n";
import type { useBuildPublication } from "../useBuildPublication";

export function BuildProgressModal({ publication }: { publication: ReturnType<typeof useBuildPublication> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const state = publication.progress;
  useEffect(() => {
    if (state && !dialog.current?.open) dialog.current?.showModal();
    if (!state && dialog.current?.open) dialog.current.close();
  }, [Boolean(state)]);
  if (!state) return null;
  const running = state.status === "running";
  return <dialog ref={dialog} className="build-progress-modal" aria-labelledby="build-progress-title" onCancel={event => { event.preventDefault(); if (!running) publication.close(); }}>
    <h2 id="build-progress-title">{t(running ? "Publicando build" : state.stage)}</h2>
    <p role="status" aria-live="polite">{t(publication.cancelling ? "Cancelando publicação" : state.stage)}</p>
    <progress max={100} value={state.percent} aria-label={t("Progresso da publicação")} />
    <strong>{state.percent}%</strong>
    <small>{t("O percentual representa as etapas concluídas da publicação.")}</small>
    {running && !state.cancellable && state.percent >= 85 && <p>{t("Finalizando no PM2. Aguarde a conclusão.")}</p>}
    {publication.connectionError && <p role="alert">{publication.connectionError}</p>}
    {state.status === "failed" && <details open>
      <summary>{t("Log da publicação")}</summary>
      <pre role={state.status === "failed" ? "alert" : undefined}>{state.logs.map(line => t(line)).join("\n") || t(state.stage)}</pre>
    </details>}
    <div className="build-progress-actions">{running
      ? <button className="project-button secondary" disabled={!state.cancellable || publication.cancelling} onClick={() => void publication.cancel()}>{t(publication.cancelling ? "Cancelando…" : "Cancelar build")}</button>
      : <button className="project-button" onClick={publication.close} autoFocus>{t("Fechar")}</button>}
    </div>
  </dialog>;
}
