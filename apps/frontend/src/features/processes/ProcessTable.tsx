import { ProcessActions, ProcessPort, ProcessStatus } from './ProcessDisplay';
import { formatMemory, formatUptime, type Process, type ProcessAction } from './processes';

export function ProcessTable({ processes, busy, onAction, onLogs }: {
  processes: Process[];
  busy: number | null;
  onAction: (process: Process, action: ProcessAction) => void;
  onLogs: (process: Process) => void;
}) {
  return <div className="glass overflow-x-auto rounded-2xl border border-line">
    <table className="w-full min-w-[1000px] text-left text-sm">
      <thead className="bg-canvas text-xs uppercase tracking-wider text-muted">
        <tr><th className="px-5 py-3">Aplicação</th><th>Status</th><th>Porta</th><th>CPU</th><th>Memória</th><th>Uptime</th><th>Reinícios</th><th className="px-5 text-right">Ações</th></tr>
      </thead>
      <tbody>
        {processes.map((process) => <tr key={process.id} className="border-t border-line/70 transition hover:bg-hover/60">
          <td className="px-5 py-4"><div className="font-medium">{process.name}</div><div className="mt-0.5 text-xs text-muted">id {process.id} · PID {process.pid || '—'} · {process.mode}</div></td>
          <td><ProcessStatus status={process.status} badge /></td>
          <td><ProcessPort process={process} /></td>
          <td>{process.cpu.toFixed(1)}%</td>
          <td>{formatMemory(process.memory)}</td>
          <td>{formatUptime(process.uptime)}</td>
          <td>{process.restarts}</td>
          <td className="px-5"><ProcessActions process={process} busy={busy} onAction={onAction} onLogs={onLogs} /></td>
        </tr>)}
      </tbody>
    </table>
  </div>;
}
