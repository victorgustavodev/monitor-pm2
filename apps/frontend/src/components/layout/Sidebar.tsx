import { useState } from "react";
import { t } from "../../i18n";
import {
  LayoutDashboard,
  History,
  ChevronDown,
  Settings,
  LogOut,
  CircleUserRound,
  FolderGit2,
} from "lucide-react";
import Logo from "../../assets/logo.png";

export type DashboardView =
  "home" | "projects" | "logs" | "users" | "settings";

export const dashboardViews = [
  {
    id: "home",
    label: "Home",
    description: "Acompanhe a saúde das aplicações e o consumo da sua VM.",
    icon: LayoutDashboard,
  },
  {
    id: "projects",
    label: "Projetos",
    description: "Explore os arquivos das aplicações e publique novas versões.",
    icon: FolderGit2,
  },
  {
    id: "logs",
    label: "Logs",
    description:
      "Consulte a saída dos processos e as ações realizadas no painel.",
    icon: History,
  },
  {
    id: "users",
    label: "Usuários",
    description: "Gerencie os usuários e seus perfis de acesso.",
    icon: CircleUserRound,
  },
  {
    id: "settings",
    label: "Configurações",
    description: "Ajuste a atualização do painel e consulte sua conexão.",
    icon: Settings,
  },
] as const;

export function Sidebar({
  view,
  onNavigate,
  username,
  count,
  busy,
  onLogout,
  isAdmin,
}: {
  view: DashboardView;
  onNavigate: (view: DashboardView) => void;
  username: string;
  count: number;
  busy: boolean;
  onLogout: () => void;
  isAdmin: boolean;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  return (
    <aside className="dashboard-sidebar" aria-label={t("Menu do monitor")}>
      <div className="sidebar-brand">
        <img
          src={Logo}
          width={214}
          height={113}
          alt="KPMG"
          className="sidebar-logo"
        />
        <div className="sidebar-product">
          <strong>{t("Monitor PM2")}</strong>
          <span>{t("Gerenciamento de aplicações")}</span>
        </div>
      </div>
      <p className="sidebar-label">{t("Navegação")}</p>
      <nav className="sidebar-nav" aria-label={t("Navegação principal")}>
        {dashboardViews.filter(item => item.id === "home" || item.id === "projects").map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className="sidebar-link"
            aria-current={view === id ? "page" : undefined}
            disabled={busy}
            onClick={() => onNavigate(id)}
          >
            <Icon size={19} strokeWidth={1.7} aria-hidden="true" />
            <span>{t(label)}</span>
            {id === "home" && <span className="sidebar-count">{count}</span>}
          </button>
        ))}
        <div className="sidebar-settings">
          <button type="button" className="sidebar-link" disabled={busy}
            aria-expanded={settingsOpen} aria-controls="sidebar-settings-menu"
            onClick={() => setSettingsOpen(open => !open)}>
            <Settings size={19} aria-hidden="true" />
            <span>{t("Configurações")}</span>
            <ChevronDown size={16} className={settingsOpen ? "sidebar-chevron expanded" : "sidebar-chevron"} aria-hidden="true" />
          </button>
          {settingsOpen && <div id="sidebar-settings-menu" className="sidebar-submenu">
            {dashboardViews.filter(item => item.id === "settings" || item.id === "logs" || (item.id === "users" && isAdmin)).map(({ id, label, icon: Icon }) => (
              <button key={id} type="button" className="sidebar-link" disabled={busy}
                aria-current={view === id ? "page" : undefined} onClick={() => onNavigate(id)}>
                <Icon size={17} aria-hidden="true" />
                <span>{t(id === "settings" ? "Geral" : label)}</span>
              </button>
            ))}
          </div>}
        </div>
      </nav>
      <div className="sidebar-footer">
        <div className="sidebar-account">
          <CircleUserRound size={30} strokeWidth={1.4} aria-hidden="true" />
          <div>
            <strong>{username || t("Usuário conectado")}</strong>
            <span>{t("Sessão ativa")}</span>
          </div>
        </div>
        <button
          type="button"
          className="sidebar-logout"
          onClick={onLogout}
          disabled={busy}
          aria-label={t("Sair do painel")}
        >
          <LogOut size={18} aria-hidden="true" />
          <span>{t("Sair do painel")}</span>
        </button>
      </div>
    </aside>
  );
}
