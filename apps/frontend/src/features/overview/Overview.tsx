import { t } from "../../i18n";
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
import { ProcessPort } from '../processes/ProcessDisplay';

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
      label: t("Processos online"),
      value: `${online}/${processes.length}`,
      detail: t("Aplicações em execução"),
      icon: Activity,
    },
    {
      label: t("CPU total"),
      value: `${cpu.toFixed(1)}%`,
      detail: t("Consumo dos processos"),
      icon: Cpu,
    },
    {
      label: t("Memória utilizada"),
      value: formatMemory(memory),
      detail: t("Total das aplicações"),
      icon: MemoryStick,
    },
    {
      label: t("Daemon PM2"),
      value: connected ? t("Conectado") : loading ? t("Conectando…") : t("Indisponível"),
      detail: t("Conexão com o gerenciador"),
      icon: Database,
    },
  ];

  return (
    <div className="overview-content">
      <section className="overview-metrics" aria-label={t("Indicadores da VM")}>
        {metrics.map(({ label, value, detail, icon: Icon }) => (
          <article key={label} className="metric-card">
            <div className="metric-top">
              <span>{label}</span>
              <div className="metric-icon">
                <Icon size={20} strokeWidth={1.7} aria-hidden="true" />
              </div>
            </div>
            <p
              className={`metric-value ${label === t("Daemon PM2") ? "metric-value-status" : ""}`}
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
            <h2 id="overview-processes-title">{t("Processos")}</h2>
            <p>{t("Suas aplicações, em um só lugar.")}</p>
          </div>
          <button type="button" onClick={onProcesses} className="section-link">
            {t("Ver todos")}<ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
        {processes.slice(0, 6).map((process) => (
          <article
            key={process.id}
            className="overview-process"
          >
            <div className="process-app-icon">
              <Server size={19} strokeWidth={1.6} aria-hidden="true" />
            </div>
            <div className="overview-process-name">
              <button type="button" onClick={onProcesses}><strong>{process.name}</strong></button>
              <ProcessPort process={process} withLabel />
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
                  ? t("Online")
                  : process.status === "stopped"
                    ? t("Parado")
                    : process.status}
              </span>
            </span>
            <button type="button" onClick={onProcesses} aria-label={t('Ver processo {0}, status {1}', { 0: process.name, 1: process.status })}><ChevronRight size={16} className="text-muted" aria-hidden="true" /></button>
          </article>
        ))}
        {!processes.length && (
          <div className="overview-empty">
            <Server size={30} strokeWidth={1.4} aria-hidden="true" />
            <p>
              {loading
                ? t("Carregando aplicações…")
                : t("Nenhum processo encontrado.")}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
