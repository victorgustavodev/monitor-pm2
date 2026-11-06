import {
  LayoutDashboard,
  Server,
  History,
  Users,
  Package,
  Settings,
  LogOut,
  CircleUserRound,
} from "lucide-react";
import Logo from "../../assets/logo.png";

export type DashboardView =
  | "overview"
  | "processes"
  | "logs"
  | "users"
  | "builds"
  | "settings";

export const dashboardViews = [
  {
    id: "overview",
    label: "Visão geral",
    description: "Acompanhe a saúde das aplicações e o consumo da sua VM.",
    icon: LayoutDashboard,
  },
  {
    id: "processes",
    label: "Processos",
    description: "Monitore portas, recursos e operações de cada aplicação.",
    icon: Server,
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
    description: "Gerencie quem pode acessar e operar o monitor.",
    icon: Users,
  },
  {
    id: "builds",
    label: "Builds",
    description:
      "Organize as versões e publique os builds das suas aplicações.",
    icon: Package,
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
}: {
  view: DashboardView;
  onNavigate: (view: DashboardView) => void;
  username: string;
  count: number;
  busy: boolean;
  onLogout: () => void;
}) {
  return (
    <aside className="dashboard-sidebar" aria-label="Menu do monitor">
      <div className="sidebar-brand">
        <img
          src={Logo}
          width={214}
          height={113}
          alt="KPMG"
          className="sidebar-logo"
        />
        <div className="sidebar-product">
          <strong>Monitor PM2</strong>
          <span>Gerenciamento de aplicações</span>
        </div>
      </div>
      <p className="sidebar-label">Navegação</p>
      <nav className="sidebar-nav" aria-label="Navegação principal">
        {dashboardViews.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className="sidebar-link"
            aria-current={view === id ? "page" : undefined}
            disabled={busy}
            onClick={() => onNavigate(id)}
          >
            <Icon size={19} strokeWidth={1.7} aria-hidden="true" />
            <span>{label}</span>
            {id === "processes" && (
              <span className="sidebar-count">{count}</span>
            )}
          </button>
        ))}
      </nav>
      <div className="sidebar-footer">
        <div className="sidebar-account">
          <CircleUserRound size={30} strokeWidth={1.4} aria-hidden="true" />
          <div>
            <strong>{username || "Usuário conectado"}</strong>
            <span>Sessão ativa</span>
          </div>
        </div>
        <button
          type="button"
          className="sidebar-logout"
          onClick={onLogout}
          disabled={busy}
          aria-label="Sair do painel"
        >
          <LogOut size={18} aria-hidden="true" />
          <span>Sair do painel</span>
        </button>
      </div>
    </aside>
  );
}
