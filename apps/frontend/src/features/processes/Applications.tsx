import type { ProcessProjectActions } from "./processes";
import { t } from "../../i18n";
import { useMemo, useState } from "react";
import { CircleOff, Search, List, LayoutGrid } from "lucide-react";
import { ProcessTable } from "./ProcessTable";
import { ProcessCards } from "./ProcessCards";
import type { Process, ProcessAction, SaveProcessLabel } from "./processes";

type ApplicationLayout = "list" | "cards";
const layoutStorageKey = "monitor-pm2:applications-layout";

function savedLayout(): ApplicationLayout {
  try {
    return window.localStorage.getItem(layoutStorageKey) === "cards"
      ? "cards"
      : "list";
  } catch {
    return "list";
  }
}

export function Applications({
  processes,
  query,
  onQueryChange,
  loading,
  busy,
  onAction,
  onLogs,
  onAdd,
  onLabelSave,
  onProjectEdit,
  onOpenProject,
}: {
  processes: Process[];
  query: string;
  onQueryChange: (value: string) => void;
  loading: boolean;
  busy: number | null;
  onAction: (process: Process, action: ProcessAction) => void;
  onLogs: (process: Process) => void;
  onAdd: () => void;
  onLabelSave: SaveProcessLabel;
} & ProcessProjectActions) {
  const [layout, setLayout] = useState<ApplicationLayout>(savedLayout);
  const filtered = useMemo(
    () =>
      processes.filter((item) =>
        `${item.name} ${item.label || ""} ${item.projectName || ""}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [processes, query],
  );

  function changeLayout(next: ApplicationLayout) {
    setLayout(next);
    try {
      window.localStorage.setItem(layoutStorageKey, next);
    } catch {
      /* A escolha continua funcionando se o navegador bloquear o armazenamento. */
    }
  }

  return (
    <section
      className="applications"
      aria-labelledby="applications-title"
      aria-busy={loading}
    >
      <div className="applications-toolbar">
        <div className="applications-heading">
          <h2 id="applications-title">{t("Aplicações")}</h2>
          <span className="applications-count">
            {query
              ? `${filtered.length} ${t("de")} ${processes.length}`
              : processes.length}{" "}
            {t(processes.length === 1 ? "processo" : "processos")}
          </span>
        </div>
        <div className="applications-controls">
          <label className="applications-search">
            <Search size={16} aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder={t("Buscar processo")}
              aria-label={t("Buscar processo")}
            />
          </label>
          <div
            className="application-layout-selector"
            role="group"
            aria-label={t("Visualização das aplicações")}
          >
            <button
              type="button"
              aria-pressed={layout === "list"}
              onClick={() => changeLayout("list")}
            >
              <List size={16} aria-hidden="true" />
              {t("Lista")}
            </button>
            <button
              type="button"
              aria-pressed={layout === "cards"}
              onClick={() => changeLayout("cards")}
            >
              <LayoutGrid size={16} aria-hidden="true" />
              {t("Cards")}
            </button>
          </div>
        </div>
      </div>
      {!loading && !filtered.length && (
        <div className="applications-empty" role="status">
          <CircleOff size={28} aria-hidden="true" />
          <p>
            {query
              ? t("Nenhum processo corresponde à busca.")
              : t("Nenhum processo encontrado.")}
          </p>
        </div>
      )}
      {layout === "list" ? (
        <ProcessTable
          onProjectEdit={onProjectEdit}
          onOpenProject={onOpenProject}
          onLabelSave={onLabelSave}
          processes={filtered}
          busy={busy}
          onAction={onAction}
          onLogs={onLogs}
        />
      ) : (
        <ProcessCards
          onProjectEdit={onProjectEdit}
          onOpenProject={onOpenProject}
          onLabelSave={onLabelSave}
          processes={filtered}
          busy={busy}
          onAction={onAction}
          onLogs={onLogs}
          onAdd={onAdd}
        />
      )}
    </section>
  );
}
