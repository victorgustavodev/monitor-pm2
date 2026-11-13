import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiError } from "../../../services/api";
import { t } from "../../../i18n";
import type { Process, ProcessSettings } from "../processes";

export function ProcessSettingsDialog({ process, busy, locked, onSave, onClose, onSessionExpired, onOpenProject }: {
  process: Process; busy: boolean; locked: boolean;
  onSave: (process: Process, autoStart: boolean) => Promise<void>;
  onClose: () => void; onSessionExpired: () => void; onOpenProject: (id: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const submitting = useRef(false);
  const [settings, setSettings] = useState<ProcessSettings | null>(null);
  const [autoStart, setAutoStart] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const element = dialog.current, trigger = document.activeElement;
    element?.showModal();
    return () => { element?.close(); if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus(); };
  }, []);
  useEffect(() => {
    let active = true;
    const query = new URLSearchParams({ name: process.name, namespace: process.namespace || "default" });
    setLoading(true); setError(""); setSettings(null);
    void api<ProcessSettings>(`/api/processes/${encodeURIComponent(process.id)}/settings?${query}`).then(value => {
      if (active) { setSettings(value); setAutoStart(value.autoStart); }
    }).catch(reason => {
      if (!active) return;
      setError((reason as Error).message);
      if (reason instanceof ApiError && reason.status === 401) onSessionExpired();
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [process.id, process.name, process.namespace, onSessionExpired, attempt]);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || locked || loading || !settings || submitting.current) return;
    submitting.current = true; setError("");
    try { await onSave(process, autoStart); onClose(); }
    catch (reason) { setError((reason as Error).message); }
    finally { submitting.current = false; }
  }
  return <dialog ref={dialog} aria-labelledby="process-settings-title"
    onCancel={event => { event.preventDefault(); if (!busy && !submitting.current) onClose(); }}
    className="m-auto max-h-[90vh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl border border-line bg-surface p-6 text-content shadow-dialog backdrop:bg-overlay">
    <form onSubmit={save} className="space-y-4" aria-busy={loading || busy}>
      <h2 id="process-settings-title" className="text-lg font-semibold">{t("Gerenciar {0}", { 0: process.label || process.name })}</h2>
      {loading && <p role="status">{t("Carregando…")}</p>}
      {settings && <>
        <label className="flex items-start gap-3 text-sm">
          <input autoFocus type="checkbox" className="mt-1" checked={autoStart}
            disabled={busy || locked || (!settings.canAutoStart && !settings.autoStart)} onChange={event => setAutoStart(event.target.checked)} />
          <span>{t("Iniciar automaticamente com o monitor")}</span>
        </label>
        <p className="text-sm text-muted">{t("Ao iniciar o monitor, inicia este processo pelo ecosystem do projeto. Processos online são preservados. Salvar não inicia nem reinicia agora.")}</p>
        <p className="text-xs text-muted">{t("Para funcionar após reiniciar a VM, o monitor precisa iniciar com o Windows usando a mesma conta do PM2.")}</p>
        {!settings.canAutoStart && <p role="status" className="text-sm text-warning">{t("Vincule o processo a um projeto e inicie-o uma vez antes de habilitar o início automático.")}</p>}
        {settings.autoStartError && <p role="alert" className="text-sm text-danger">{settings.autoStartError}</p>}
        {settings.projectId && <button type="button" className="text-sm text-link" disabled={busy}
          onClick={() => { onClose(); onOpenProject(settings.projectId!); }}>{t("Abrir projeto")}</button>}
      </>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {!settings && !loading && <button type="button" onClick={() => setAttempt(value => value + 1)}>{t("Tentar novamente")}</button>}
      <div className="flex justify-end gap-3">
        <button type="button" className="project-button secondary" disabled={busy} onClick={onClose}>{t("Cancelar")}</button>
        <button className="project-button" disabled={busy || locked || loading || !settings || autoStart === settings.autoStart}>{t(busy ? "Salvando…" : "Salvar")}</button>
      </div>
    </form>
  </dialog>;
}
