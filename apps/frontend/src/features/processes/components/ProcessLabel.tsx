import { useState, type FormEvent } from "react";
import { t } from "../../../i18n";
import type { Process, SaveProcessLabel } from "../processes";

export function ProcessLabel({
  process,
  busy,
  onSave,
}: {
  process: Process;
  busy: boolean;
  onSave: SaveProcessLabel;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError("");
    try {
      await onSave(process, draft);
      setEditing(false);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : t("Não foi possível salvar o nome de exibição."),
      );
    }
  }
  if (editing)
    return (
      <form className="process-label-editor" onSubmit={submit}>
        <input
          aria-label={t("Nome de exibição de {0}", { 0: process.name })}
          placeholder="workTabs"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={80}
          disabled={busy}
          autoFocus
        />
        <small>{t("Deixe em branco para remover o nome de exibição.")}</small>
        {error && (
          <p role="alert" className="process-label-error">
            {error}
          </p>
        )}
        <div>
          <button type="submit" disabled={busy}>
            {busy ? t("Salvando…") : t("Salvar")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setEditing(false)}
          >
            {t("Cancelar")}
          </button>
        </div>
      </form>
    );
  return (
    <div className="process-label">
      <strong className={process.label ? "process-label-value" : "font-medium text-content"}>
        {process.label || process.name}
      </strong>
      {!process.startProjectId && <button
        type="button"
        disabled={busy}
        aria-label={t("Editar nome de exibição de {0}", { 0: process.name })}
        onClick={() => {
          setDraft(process.label || "");
          setError("");
          setEditing(true);
        }}
      >
        {process.label ? t("Editar nome") : t("Adicionar nome")}
      </button>}
    </div>
  );
}
