import { t } from "../../../i18n";
import { useEffect, useState, type FormEvent } from "react";
import { RefreshCw } from "lucide-react";
import { api, ApiError } from "../../../services/api";
import { dateLocale } from "../../../i18n";
type Retention = {
  enabled: boolean;
  retentionDays: number;
  lastRunAt?: string;
  lastDeleted?: number;
  lastError?: string;
};

export function RetentionSettings({
  onBusyChange,
  onSessionExpired,
}: {
  onBusyChange: (busy: boolean) => void;
  onSessionExpired: () => void;
}) {
  const [retention, setRetention] = useState<Retention | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    void api<Retention>("/api/settings/retention", {
      signal: controller.signal,
    })
      .then((value) => {
        if (!controller.signal.aborted) setRetention(value);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        if (reason instanceof ApiError && reason.status === 401)
          onSessionExpired();
        setError(
          reason instanceof Error
            ? reason.message
            : t("Não foi possível carregar as configurações."),
        );
      });
    return () => controller.abort();
  }, [onSessionExpired, reload]);
  useEffect(() => {
    onBusyChange(busy);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!retention || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      setRetention(
        await api<Retention>("/api/settings/retention", {
          method: "PUT",
          body: JSON.stringify({
            enabled: retention.enabled,
            retentionDays: retention.retentionDays,
          }),
        }),
      );
      setNotice(t("Configurações salvas."));
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401)
        onSessionExpired();
      setError(
        reason instanceof Error
          ? reason.message
          : t("Não foi possível salvar as configurações."),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="settings-card">
      <div className="settings-icon">
        <RefreshCw size={21} aria-hidden="true" />
      </div>
      <div>
        <h2>{t("Limpeza automática de versões")}</h2>
        <p>
          {t("Remova pacotes e históricos antigos para liberar espaço na VM.")}
        </p>
      </div>
      {error && (
        <p role="alert" className="project-message error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="project-message success">
          {notice}
        </p>
      )}
      {!retention ? (
        <button
          className="project-button secondary"
          onClick={() => setReload((value) => value + 1)}
        >
          {t("Carregar configurações")}
        </button>
      ) : (
        <form onSubmit={save} className="retention-form">
          <label className="refresh-preference">
            <div>
              <strong>{t("Habilitar limpeza automática")}</strong>
              <span>
                {t("Esta configuração vale para todos os usuários do monitor.")}
              </span>
            </div>
            <input
              type="checkbox"
              checked={retention.enabled}
              disabled={busy}
              onChange={(event) =>
                setRetention({ ...retention, enabled: event.target.checked })
              }
            />
          </label>
          <div className="retention-fields">
            <label className="settings-field">
              {t("Excluir cada versão após (dias)")}
              <input
                name="retentionDays"
                aria-describedby="retention-age-help"
                type="number"
                min={1}
                max={3650}
                step={1}
                required
                disabled={busy || !retention.enabled}
                value={retention.retentionDays}
                onChange={(event) =>
                  setRetention({
                    ...retention,
                    retentionDays: Number(event.target.value),
                  })
                }
              />
            </label>
          </div>
          <p id="retention-age-help" className="settings-note">
            {t("O prazo conta da data de envio de cada versão. Com 7 dias, uma versão enviada hoje vence daqui a 7 dias. A exclusão ocorre automaticamente em até um minuto após o vencimento, enquanto o monitor estiver disponível.")}
          </p>
          <p className="settings-note">
            {t("Desabilitada por padrão. Ao ativar ou reduzir o prazo, versões existentes que já atingiram essa idade também ficam sujeitas à exclusão.")}
          </p>
          <p className="settings-note">
            {t(
              "A limpeza exclui permanentemente versões antigas e seus arquivos. Builds ativos, publicações em andamento e arquivos usados pelo PM2 são preservados. A pasta principal dos projetos não é apagada.",
            )}
          </p>
          {retention.lastRunAt && (
            <p className="settings-note">
              {t("Última limpeza:")}{" "}
              {new Date(retention.lastRunAt).toLocaleString(dateLocale())} ·{" "}
              {retention.lastDeleted ?? 0} {t("versões removidas")}
            </p>
          )}
          {retention.lastError && (
            <p role="status" className="project-message error">
              {retention.lastError}
            </p>
          )}
          <button className="project-button" disabled={busy}>
            {busy ? t("Salvando…") : t("Salvar configurações")}
          </button>
        </form>
      )}
    </section>
  );
}
