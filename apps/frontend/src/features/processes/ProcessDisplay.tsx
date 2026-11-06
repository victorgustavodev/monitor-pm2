import {
  Ban,
  Play,
  RotateCw,
  SquareChevronRight,
  Trash2,
  RefreshCw,
  CircleCheck,
  CircleOff,
  CircleAlert,
} from "lucide-react";
import type { Process, ProcessAction } from "./processes";

export type ProcessActionProps = {
  process: Process;
  busy: number | null;
  onAction: (process: Process, action: ProcessAction) => void;
  onLogs: (process: Process) => void;
};

export function ProcessActions({
  process,
  busy,
  onAction,
  onLogs,
  spread = false,
}: ProcessActionProps & { spread?: boolean }) {
  const running = process.status === "online";
  return (
    <div
      className={`process-actions ${spread ? "process-actions-spread" : ""}`}
      aria-label={`Ações de ${process.name}`}
    >
      <button
        type="button"
        title="Logs"
        aria-label={`Ver logs de ${process.name}`}
        disabled={busy !== null}
        onClick={() => onLogs(process)}
        className="process-action hover:bg-hover hover:text-link-hover"
      >
        <SquareChevronRight size={17} aria-hidden="true" />
      </button>
      <button
        type="button"
        title="Reiniciar"
        aria-label={`Reiniciar ${process.name}`}
        disabled={busy !== null}
        onClick={() => onAction(process, "restart")}
        className="process-action hover:bg-hover hover:text-link-hover"
      >
        <RotateCw size={17} aria-hidden="true" />
      </button>
      <button
        type="button"
        title={running ? "Parar" : "Iniciar"}
        aria-label={`${running ? "Parar" : "Iniciar"} ${process.name}`}
        disabled={busy !== null}
        onClick={() => onAction(process, running ? "stop" : "start")}
        className={`process-action ${running ? "hover:bg-warning-surface hover:text-warning" : "hover:bg-success-surface hover:text-success"}`}
      >
        {running ? (
          <Ban size={17} aria-hidden="true" />
        ) : (
          <Play size={17} aria-hidden="true" />
        )}
      </button>
      <button
        type="button"
        title="Remover"
        aria-label={`Remover ${process.name}`}
        disabled={busy !== null}
        onClick={() => onAction(process, "delete")}
        className="process-action hover:bg-danger-surface hover:text-danger"
      >
        <Trash2 size={17} aria-hidden="true" />
      </button>
      {busy === process.id && (
        <span className="process-action-progress" role="status">
          <RefreshCw size={16} className="animate-spin" aria-hidden="true" />
          <span className="sr-only">Executando ação em {process.name}…</span>
        </span>
      )}
    </div>
  );
}

export function ProcessStatus({
  status,
  badge = false,
}: {
  status: string;
  badge?: boolean;
}) {
  const label =
    (
      {
        online: "Online",
        stopped: "Parado",
        errored: "Erro",
        launching: "Iniciando",
        stopping: "Parando",
      } as Record<string, string>
    )[status] || status;
  const color =
    status === "online"
      ? "text-success"
      : status === "stopped"
        ? "text-muted"
        : status === "errored"
          ? "text-danger"
          : "text-warning";
  const surface =
    status === "online"
      ? "bg-success-surface"
      : status === "stopped"
        ? "bg-subtle"
        : status === "errored"
          ? "bg-danger-surface"
          : "bg-warning-surface";
  const Icon =
    status === "online"
      ? CircleCheck
      : status === "stopped"
        ? CircleOff
        : CircleAlert;
  return (
    <span
      className={`process-status ${color} ${badge ? `process-status-badge ${surface}` : ""}`}
      aria-label={`Status: ${label}`}
    >
      <Icon size={16} aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

export function ProcessPort({
  process,
  withLabel = false,
}: {
  process: Process;
  withLabel?: boolean;
}) {
  const hasPort = Boolean(process.ports?.length);
  const title =
    process.portSource === "listening"
      ? "Portas TCP em escuta neste processo ou em seus subprocessos"
      : process.portSource === "configured"
        ? "Porta informada na configuração; não confirmada em escuta"
        : "Porta não identificada";
  return (
    <div className="process-port" title={title}>
      <span>
        {withLabel
          ? hasPort
            ? `${process.ports.length > 1 ? "Portas" : "Porta"} `
            : "Porta não identificada"
          : null}
        {hasPort ? (
          <span className="font-mono tabular-nums">
            {process.ports.join(", ")}
          </span>
        ) : !withLabel ? (
          "—"
        ) : null}
      </span>
      {process.portSource === "configured" && (
        <span className="process-port-note">Configurada</span>
      )}
    </div>
  );
}
