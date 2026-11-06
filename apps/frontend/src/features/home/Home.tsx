import type { ReactNode } from "react";
import { Activity, Cpu, Database, MemoryStick } from "lucide-react";
import { t } from "../../i18n";
import { formatMemory, type Process } from "../processes/processes";

export function Home({
  processes,
  connected,
  loading,
  children,
}: {
  processes: Process[];
  connected: boolean;
  loading: boolean;
  children: ReactNode;
}) {
  const online = processes.filter(
    (process) => process.status === "online",
  ).length;
  const cpu = processes.reduce((total, process) => total + process.cpu, 0);
  const memory = processes.reduce(
    (total, process) => total + process.memory,
    0,
  );
  const metrics = [
    {
      id: "online",
      label: t("Processos online"),
      value: `${online}/${processes.length}`,
      detail: t("Aplicações em execução"),
      Icon: Activity,
    },
    {
      id: "cpu",
      label: t("CPU total"),
      value: `${cpu.toFixed(1)}%`,
      detail: t("Consumo dos processos"),
      Icon: Cpu,
    },
    {
      id: "memory",
      label: t("Memória utilizada"),
      value: formatMemory(memory),
      detail: t("Total das aplicações"),
      Icon: MemoryStick,
    },
    {
      id: "daemon",
      label: t("Daemon PM2"),
      value: connected
        ? t("Conectado")
        : loading
          ? t("Conectando…")
          : t("Indisponível"),
      detail: t("Conexão com o gerenciador"),
      Icon: Database,
    },
  ];
  return (
    <div className="home-content">
      <section className="overview-metrics" aria-label={t("Indicadores da VM")}>
        {metrics.map(({ id, label, value, detail, Icon }) => (
          <article key={id} className="metric-card">
            <div className="metric-top">
              <span>{label}</span>
              <div className="metric-icon">
                <Icon size={20} strokeWidth={1.7} aria-hidden="true" />
              </div>
            </div>
            <p
              className={`metric-value ${id === "daemon" ? "metric-value-status" : ""}`}
            >
              {value}
            </p>
            <p className="metric-detail">{detail}</p>
          </article>
        ))}
      </section>
      {children}
    </div>
  );
}
