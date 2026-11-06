import { Box, CirclePlus } from "lucide-react";
import { ProcessActions, ProcessPort, ProcessStatus } from "./ProcessDisplay";
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
}: {
  processes: Process[];
  busy: number | null;
  onAction: (process: Process, action: ProcessAction) => void;
  onLogs: (process: Process) => void;
  onAdd: () => void;
}) {
  return (
    <div className="application-grid">
      {processes.map((process) => (
        <article
          key={process.id}
          className="application-card"
          aria-label={`Aplicação ${process.name}`}
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
              <dt>Memória</dt>
              <dd>{formatMemory(process.memory)}</dd>
            </div>
          </dl>
          <div className="application-card-details">
            <span>Uptime {formatUptime(process.uptime)}</span>
            <span>
              {process.restarts}{" "}
              {process.restarts === 1 ? "reinício" : "reinícios"}
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
        onClick={onAdd}
        aria-label="Adicionar novo processo"
      >
        <CirclePlus size={26} strokeWidth={1.5} aria-hidden="true" />
        <span>Novo processo</span>
      </button>
    </div>
  );
}
