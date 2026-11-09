import { useEffect, useRef, useState } from "react";
import { t } from "../../../i18n";
import type { Process, ProcessAction } from "../processes";

export function ProcessActionConfirmation({ process, action, locked, onConfirm, onClose }: {
  process: Process; action: ProcessAction; locked: boolean;
  onConfirm: () => Promise<void>; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pending = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  async function confirm() {
    if (locked || pending.current) return;
    pending.current = true; setSaving(true); setError("");
    try { await onConfirm(); onClose(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : t("Não foi possível concluir a operação.")); }
    finally { pending.current = false; setSaving(false); }
  }
  return <dialog ref={dialog} className="process-confirmation" aria-labelledby="process-confirm-title" aria-describedby="process-confirm-message" onCancel={event => { if (saving) event.preventDefault(); else onClose(); }}>
    <h2 id="process-confirm-title">{t("Tem certeza?")}</h2>
    <p id="process-confirm-message" className="process-confirm-danger">{action === "stop"
      ? t("Parar o processo {0}? A aplicação ficará indisponível até ser iniciada novamente.", { 0: process.name })
      : t("Excluir o processo {0} do PM2? Ele será encerrado e removido da lista de processos.", { 0: process.name })}</p>
    {locked && !saving && <p role="status">{t("As ações dos processos estão bloqueadas durante publicações.")}</p>}
    {error && <p role="alert" className="process-confirm-danger">{error}</p>}
    <div className="project-form-actions">
      <button className="project-button secondary" autoFocus disabled={saving} onClick={onClose}>{t("Cancelar")}</button>
      <button className="project-button danger" disabled={locked || saving} onClick={() => void confirm()}>{saving ? t("Executando…") : t(action === "stop" ? "Confirmar parada" : "Confirmar exclusão")}</button>
    </div>
  </dialog>;
}
