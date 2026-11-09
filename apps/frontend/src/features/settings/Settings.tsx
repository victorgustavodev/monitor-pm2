import { t } from "../../i18n";
import { RefreshCw, Globe, CircleUserRound } from "lucide-react";
import { RetentionSettings } from "./components/RetentionSettings";
import { getLocale, setLocale, type Locale } from "../../i18n";
import { useEffect, useState } from "react";

export function Settings({
  autoRefresh,
  onAutoRefreshChange,
  username,
  onBusyChange,
  onSessionExpired,
}: {
  autoRefresh: boolean;
  onAutoRefreshChange: (enabled: boolean) => void;
  username: string;
  onBusyChange: (busy: boolean) => void;
  onSessionExpired: () => void;
}) {
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    onBusyChange(busy);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);
  return (
    <div className="settings-content">
      <section className="settings-card">
        <div className="settings-icon">
          <Globe size={21} aria-hidden="true" />
        </div>
        <div>
          <h2>{t("Idioma")}</h2>
          <p>{t("Escolha o idioma deste navegador.")}</p>
        </div>
        <label className="settings-field">
          {t("Idioma da interface")}
          <select
            value={getLocale()}
            onChange={(event) => setLocale(event.target.value as Locale)}
          >
            <option value="pt-BR">Português (Brasil)</option>
            <option value="en">English</option>
            <option value="es">Español</option>
          </select>
        </label>
      </section>
      <section
        className="settings-card"
        aria-labelledby="refresh-settings-title"
      >
        <div className="settings-icon">
          <RefreshCw size={21} strokeWidth={1.6} aria-hidden="true" />
        </div>
        <div>
          <h2 id="refresh-settings-title">{t("Atualização do painel")}</h2>
          <p>
            {t(
              "Escolha como acompanhar os indicadores e a lista de processos nesta sessão.",
            )}
          </p>
        </div>
        <label className="refresh-preference">
          <div>
            <strong>{t("Atualização ao vivo")}</strong>
            <span>
              {t(
                "Receber mudanças nas métricas e nos processos pela conexão contínua com o servidor.",
              )}
            </span>
          </div>
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(event) => onAutoRefreshChange(event.target.checked)}
          />
        </label>
        <p className="settings-note">
          {t(
            "Você também pode atualizar os dados a qualquer momento pelo botão Atualizar.",
          )}
        </p>
      </section>
      <section
        className="settings-card"
        aria-labelledby="connection-settings-title"
      >
        <div className="settings-icon">
          <Globe size={21} strokeWidth={1.6} aria-hidden="true" />
        </div>
        <div>
          <h2 id="connection-settings-title">{t("Conexão atual")}</h2>
          <p>{t("Informações de acesso a este monitor.")}</p>
        </div>
        <dl className="connection-details">
          <div>
            <dt>{t("Endereço do painel")}</dt>
            <dd>{window.location.origin}</dd>
          </div>
          <div>
            <dt>{t("Usuário conectado")}</dt>
            <dd className="flex items-center gap-2">
              <CircleUserRound size={16} aria-hidden="true" />
              {username || t("Sessão autenticada")}
            </dd>
          </div>
        </dl>
      </section>
      <RetentionSettings
        onBusyChange={setBusy}
        onSessionExpired={onSessionExpired}
      />
    </div>
  );
}
