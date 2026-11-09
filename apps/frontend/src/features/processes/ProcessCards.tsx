import { ProcessProject } from "./components/ProcessProject";
import type { ProcessProjectActions } from "./processes";
import { t } from "../../i18n";
import { Box, CirclePlus } from "lucide-react";
import { ProcessActions, ProcessPort, ProcessStatus } from "./ProcessDisplay";
import { ProcessLabel } from "./components/ProcessLabel";
import type { SaveProcessLabel } from "./processes";
import {
  formatMemory,
  formatUptime,
  type Process,
  type ProcessAction,
} from "./processes";

export function ProcessCards({
  processes,
  busy,
  onAction,
  onLogs,
  onAdd,
  onLabelSave,
  onProjectEdit,
  onOpenProject,
}: {
  processes: Process[];
  busy: number | null;
  onAction: (process: Process, action: ProcessAction) => void;
  onLogs: (process: Process) => void;
  onAdd: () => void;
  onLabelSave: SaveProcessLabel;
} & ProcessProjectActions) {
  return (
    <div className="application-grid">
      {processes.map((process) => (
        <article
          key={process.id}
          className="application-card"
          aria-label={t("Aplicação {0}", { 0: process.name })}
        >
          <div className="application-card-top">
            <Box
              size={22}
              strokeWidth={1.6}
              className="text-accent"
              aria-hidden="true"
            />
            <ProcessStatus status={process.status} />
          </div>
          <h3>{process.name}</h3>
          <div className="application-card-label">
            <small>{t("Nome de exibição")}</small>
            <ProcessLabel
              process={process}
              busy={busy !== null}
              onSave={onLabelSave}
            />
          </div>
          <div className="application-card-label"><small>{t("Projeto")}</small><ProcessProject process={process} busy={busy !== null} onProjectEdit={onProjectEdit} onOpenProject={onOpenProject} /></div>
          <ProcessPort process={process} withLabel />
          <p className="application-card-meta">
            id {process.id} · PID {process.pid || "—"} · {process.mode}
          </p>
          <dl className="application-card-metrics">
            <div>
              <dt>CPU</dt>
              <dd>{process.cpu.toFixed(1)}%</dd>
            </div>
            <div>
              <dt>{t("Memória")}</dt>
              <dd>{formatMemory(process.memory)}</dd>
            </div>
          </dl>
          <div className="application-card-details">
            <span>
              {t("Uptime")} {formatUptime(process.uptime)}
            </span>
            <span>
              {process.restarts}{" "}
              {process.restarts === 1 ? t("reinício") : t("reinícios")}
            </span>
          </div>
          <ProcessActions
            process={process}
            busy={busy}
            onAction={onAction}
            onLogs={onLogs}
            spread
          />
        </article>
      ))}
      <button
        type="button"
        className="application-add-card"
        disabled={busy !== null}
        onClick={onAdd}
        aria-label={t("Adicionar novo processo")}
      >
        <CirclePlus size={26} strokeWidth={1.5} aria-hidden="true" />
        <span>{t("Novo processo")}</span>
      </button>
    </div>
  );
}
