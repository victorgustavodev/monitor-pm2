import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { HttpError } from "../common/http-error";

export type BuildProgress = {
  id: string; percent: number; stage: string;
  status: "running" | "succeeded" | "failed" | "cancelled";
  cancellable: boolean; logs: string[];
};
export type BuildControl = {
  signal: AbortSignal;
  report: (percent: number, stage: string, cancellable?: boolean) => void;
};
type Operation = {
  project: string; username: string; updated: number; claimed: boolean;
  controller: AbortController; events: EventEmitter; state: BuildProgress;
};
const operations = new Map<string, Operation>();
export function createBuildOperation(project: string, username: string) {
  for (const [id, op] of operations)
    if ((!op.claimed || op.state.status !== "running") && Date.now() - op.updated > 30 * 60_000)
      operations.delete(id);
  if ([...operations.values()].filter(op => op.username === username && op.state.status === "running").length >= 5)
    throw new HttpError(409, "Há publicações pendentes. Conclua ou cancele antes de continuar.");
  const state: BuildProgress = { id: randomUUID(), percent: 0, stage: "Enviando pacote", status: "running", cancellable: true, logs: [] };
  operations.set(state.id, { project, username, state, updated: Date.now(), claimed: false, controller: new AbortController(), events: new EventEmitter() });
  return state;
}
export function getBuildOperation(id: unknown, project: string, username: string) {
  const op = typeof id === "string" ? operations.get(id) : undefined;
  if (!op || op.project !== project || op.username !== username)
    throw new HttpError(404, "Publicação não encontrada. O monitor pode ter reiniciado.");
  return op;
}
function emit(op: Operation) { op.updated = Date.now(); op.events.emit("progress", op.state); }
export function cancelBuildOperation(op: Operation) {
  if (op.state.status !== "running" || op.controller.signal.aborted) return;
  if (!op.state.cancellable) throw new HttpError(409, "A publicação já está sendo finalizada no PM2.");
  op.controller.abort(new Error("Publicação cancelada pelo usuário."));
  op.state.cancellable = false;
  op.state.stage = "Cancelando publicação";
  if (!op.claimed) op.state.status = "cancelled";
  emit(op);
}
export async function runBuildOperation<T>(op: Operation, action: (control: BuildControl) => Promise<T>) {
  if (op.claimed) throw new HttpError(409, "Esta publicação já foi iniciada.");
  op.claimed = true;
  const report: BuildControl["report"] = (percent, stage, cancellable = true) => {
    op.controller.signal.throwIfAborted();
    if (percent === op.state.percent && stage === op.state.stage && cancellable === op.state.cancellable) return;
    op.state.percent = Math.max(op.state.percent, Math.min(99, percent));
    op.state.stage = stage;
    op.state.cancellable = cancellable;
    if (op.state.logs.at(-1) !== stage) op.state.logs = [...op.state.logs.slice(-98), stage];
    emit(op);
  };
  try {
    const result = await action({ signal: op.controller.signal, report });
    op.state.status = "succeeded"; op.state.percent = 100; op.state.stage = "Build publicado";
    return result;
  } catch (error) {
    op.state.status = op.controller.signal.aborted ? "cancelled" : "failed";
    op.state.stage = op.controller.signal.aborted ? "Publicação cancelada" : "Falha ao publicar o build";
    op.state.logs.push(error instanceof Error ? error.message : String(error));
    if (op.controller.signal.aborted) throw new HttpError(409, error instanceof Error ? error.message : "Publicação cancelada pelo usuário.");
    throw error;
  } finally { op.state.cancellable = false; emit(op); }
}
