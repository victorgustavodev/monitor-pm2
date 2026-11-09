import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { HttpError } from "../common/http-error";

export type BuildProgress = {
  id: string; percent: number; stage: string;
  status: "running" | "succeeded" | "failed" | "cancelled";
  cancellable: boolean; logs: string[];
};
export type BuildControl = {
  operationId?: string;
  signal: AbortSignal;
  report: (percent: number, stage: string, cancellable?: boolean) => void;
};
type Operation = {
  project: string; projectName: string; username: string; updated: number; claimed: boolean; submitted: boolean;
  controller: AbortController; events: EventEmitter; state: BuildProgress;
};
const operations = new Map<string, Operation>();
export const buildEvents = new EventEmitter();
buildEvents.setMaxListeners(0);
let manualActions = 0;
function expireOperations() {
  for (const [id, op] of operations) {
    if (!op.claimed && !op.submitted && op.state.status === "running" && Date.now() - op.updated > 5 * 60_000) {
      op.state.status = "cancelled";
      op.state.cancellable = false;
      op.state.stage = "Envio não iniciado. Inicie uma nova publicação.";
      op.controller.abort(new Error(op.state.stage));
      emit(op);
    }
    if (op.state.status !== "running" && Date.now() - op.updated > 30 * 60_000) operations.delete(id);
  }
}
export function activeBuildOperation(project?: string) {
  expireOperations();
  return [...operations.values()].find(op => op.state.status === "running" && (!project || op.project === project));
}
export function listBuildOperations(username: string) {
  expireOperations();
  const rows = [...operations.values()];
  const visible = [...rows.filter(op => op.state.status === "running"),
    ...rows.filter(op => op.state.status !== "running").sort((a, b) => b.updated - a.updated).slice(0, 20)];
  return visible.map(op => ({ ...op.state, projectId: op.project, projectName: op.projectName,
    username: op.username, canCancel: op.username === username && op.state.cancellable }));
}
export async function withManualProcessAction<T>(action: () => Promise<T>) {
  if (activeBuildOperation()) throw new HttpError(409, "As ações dos processos estão bloqueadas durante publicações.");
  manualActions++;
  try { return await action(); } finally { manualActions--; }
}
export function createBuildOperation(project: string, username: string, projectName = "Projeto") {
  if (manualActions) throw new HttpError(409, "Aguarde a conclusão das ações dos processos antes de publicar.");
  if (activeBuildOperation(project)) throw new HttpError(409, "Já existe uma publicação em andamento neste projeto.");
  if ([...operations.values()].filter(op => op.username === username && op.state.status === "running").length >= 5)
    throw new HttpError(409, "Há publicações pendentes. Conclua ou cancele antes de continuar.");
  const state: BuildProgress = { id: randomUUID(), percent: 0, stage: "Enviando pacote", status: "running", cancellable: true, logs: [] };
  operations.set(state.id, { project, projectName, username, state, updated: Date.now(), claimed: false, submitted: false, controller: new AbortController(), events: new EventEmitter() });
  buildEvents.emit("change");
  return state;
}
export function getBuildOperation(id: unknown, project: string, username: string) {
  expireOperations();
  const op = typeof id === "string" ? operations.get(id) : undefined;
  if (!op || op.project !== project || op.username !== username)
    throw new HttpError(404, "Publicação não encontrada. O monitor pode ter reiniciado.");
  return op;
}
export function submitBuildOperation(op: Operation) {
  if (op.submitted || op.claimed || op.state.status !== "running") throw new HttpError(409, "Esta publicação já foi iniciada ou encerrada.");
  op.submitted = true;
  emit(op);
}
function emit(op: Operation) { op.updated = Date.now(); op.events.emit("progress", op.state); buildEvents.emit("change"); }
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
    const result = await action({ operationId: op.state.id, signal: op.controller.signal, report });
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
