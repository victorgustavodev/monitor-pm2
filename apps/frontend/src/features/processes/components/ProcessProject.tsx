import { t } from "../../../i18n";
import type { Process, ProcessProjectActions } from "../processes";

export function ProcessProject({ process, busy, onProjectEdit, onOpenProject }: { process: Process; busy: boolean } & ProcessProjectActions) {
  return <div className="process-label">
    {process.projectId
      ? <button type="button" disabled={busy} onClick={() => onOpenProject(process.projectId!)}>{process.projectName}</button>
      : <span className="text-muted">{t("Sem projeto")}</span>}
    <button type="button" disabled={busy} onClick={() => onProjectEdit(process)}
      aria-label={t("Vincular projeto a {0}", { 0: process.name })}>
      {t(process.projectId ? "Alterar vínculo" : "Vincular projeto")}
    </button>
  </div>;
}
