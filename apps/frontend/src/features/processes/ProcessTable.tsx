import { ProcessProject } from "./components/ProcessProject";
import type { ProcessProjectActions } from "./processes";
import { t } from "../../i18n";
import { ProcessActions, ProcessPort, ProcessStatus } from "./ProcessDisplay";
import { ProcessLabel } from "./components/ProcessLabel";
import type { SaveProcessLabel } from "./processes";
import {
  formatMemory,
  formatUptime,
  type Process,
  type ProcessAction,
} from "./processes";

export function ProcessTable({
  processes,
  busy,
  onAction,
  onLogs,
  onManage,
  onLabelSave,
  onProjectEdit,
  onOpenProject,
}: {
  processes: Process[];
  busy: Process["id"] | null;
  onAction: (process: Process, action: ProcessAction) => void;
  onLogs: (process: Process) => void;
  onManage: (process: Process) => void;
  onLabelSave: SaveProcessLabel;
} & ProcessProjectActions) {
  return (
    <div className="glass overflow-x-auto rounded-2xl border border-line">
      <table className="w-full min-w-[1000px] text-left text-sm">
        <thead className="bg-canvas text-xs uppercase tracking-wider text-muted">
          <tr>
            <th className="px-5 py-3">{t("Aplicação")}</th>
            <th className="px-3">{t("Projeto")}</th>
            <th>{t("Status")}</th>
            <th>{t("Porta")}</th>
            <th>CPU</th>
            <th>{t("Memória")}</th>
            <th>{t("Uptime")}</th>
            <th>{t("Reinícios")}</th>
            <th className="px-5 text-right">{t("Ações")}</th>
          </tr>
        </thead>
        <tbody>
          {processes.map((process) => (
            <tr
              key={process.id}
              className="border-t border-line/70 transition hover:bg-hover/60"
            >
              <td className="px-5 py-4">
                <ProcessLabel process={process} busy={busy !== null} onSave={onLabelSave} />
                {process.label && <div className="mt-1 text-xs text-muted">{process.name}</div>}
                {process.applicationUrl && <a className="text-xs text-link" href={process.applicationUrl} target="_blank" rel="noopener noreferrer">{t("Abrir aplicação")}</a>}
                <div className="mt-0.5 text-xs text-muted">
                  {process.startProjectId ? t("Aguardando início pelo projeto") : <>id {process.id} · PID {process.pid || "—"} · {process.mode}</>}
                </div>
              </td>
              <td className="px-3 py-4"><ProcessProject process={process} busy={busy !== null} onProjectEdit={onProjectEdit} onOpenProject={onOpenProject} /></td>
              <td>
                <ProcessStatus status={process.status} badge />
              </td>
              <td>
                <ProcessPort process={process} />
              </td>
              <td>{process.cpu.toFixed(1)}%</td>
              <td>{formatMemory(process.memory)}</td>
              <td>{formatUptime(process.uptime)}</td>
              <td>{process.restarts}</td>
              <td className="px-5">
                <ProcessActions
                  process={process}
                  busy={busy}
                  onAction={onAction}
                  onLogs={onLogs}
                  onManage={onManage}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
