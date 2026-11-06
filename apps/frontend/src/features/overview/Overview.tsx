import {
  Activity,
  Cpu,
  Database,
  MemoryStick,
  CircleCheck,
  CircleAlert,
  CircleOff,
  ChevronRight,
  Server,
} from "lucide-react";
import { formatMemory, type Process } from "../processes/processes";

export function Overview({
  processes,
  connected,
  loading,
  onProcesses,
}: {
  processes: Process[];
  connected: boolean;
  loading: boolean;
  onProcesses: () => void;
}) {
  const online = processes.filter((item) => item.status === "online").length;
  const cpu = processes.reduce((total, item) => total + item.cpu, 0);
  const memory = processes.reduce((total, item) => total + item.memory, 0);
  const metrics = [
    {
      label: "Processos online",
      value: `${online}/${processes.length}`,
      detail: "Aplicações em execução",
      icon: Activity,
    },
    {
      label: "CPU total",
      value: `${cpu.toFixed(1)}%`,
      detail: "Consumo dos processos",
      icon: Cpu,
    },
    {
      label: "Memória utilizada",
      value: formatMemory(memory),
      detail: "Total das aplicações",
      icon: MemoryStick,
    },
    {
      label: "Daemon PM2",
      value: connected ? "Conectado" : loading ? "Conectando…" : "Indisponível",
      detail: "Conexão com o gerenciador",
      icon: Database,
    },
  ];

  return (
    <div className="overview-content">
      <section className="overview-metrics" aria-label="Indicadores da VM">
        {metrics.map(({ label, value, detail, icon: Icon }) => (
          <article key={label} className="metric-card">
            <div className="metric-top">
              <span>{label}</span>
              <div className="metric-icon">
                <Icon size={20} strokeWidth={1.7} aria-hidden="true" />
              </div>
            </div>
            <p
              className={`metric-value ${label === "Daemon PM2" ? "metric-value-status" : ""}`}
            >
              {value}
            </p>
            <p className="metric-detail">{detail}</p>
          </article>
        ))}
      </section>
      <section
        className="overview-processes"
        aria-labelledby="overview-processes-title"
      >
        <div className="section-heading">
          <div>
            <h2 id="overview-processes-title">Processos</h2>
            <p>Suas aplicações, em um só lugar.</p>
          </div>
          <button type="button" onClick={onProcesses} className="section-link">
            Ver todos
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
        {processes.slice(0, 6).map((process) => (
          <button
            key={process.id}
            type="button"
            className="overview-process"
            onClick={onProcesses}
            aria-label={`Ver processo ${process.name}, status ${process.status}`}
          >
            <div className="process-app-icon">
              <Server size={19} strokeWidth={1.6} aria-hidden="true" />
            </div>
            <div className="overview-process-name">
              <strong>{process.name}</strong>
              <span>
                {process.mode} ·{" "}
                {process.ports?.length
                  ? `Porta ${process.ports.join(", ")}${process.portSource === "configured" ? " (configurada)" : ""}`
                  : "Porta não identificada"}
              </span>
            </div>
            <span
              className={`overview-process-status ${process.status === "online" ? "text-success" : process.status === "stopped" ? "text-muted" : "text-warning"}`}
            >
              {process.status === "online" ? (
                <CircleCheck size={18} aria-hidden="true" />
              ) : process.status === "stopped" ? (
                <CircleOff size={18} aria-hidden="true" />
              ) : (
                <CircleAlert size={18} aria-hidden="true" />
              )}
              <span>
                {process.status === "online"
                  ? "Online"
                  : process.status === "stopped"
                    ? "Parado"
                    : process.status}
              </span>
            </span>
            <ChevronRight size={16} className="text-muted" aria-hidden="true" />
          </button>
        ))}
        {!processes.length && (
          <div className="overview-empty">
            <Server size={30} strokeWidth={1.4} aria-hidden="true" />
            <p>
              {loading
                ? "Carregando aplicações…"
                : "Nenhum processo encontrado."}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
