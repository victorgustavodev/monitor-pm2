export type Process = {
  id: number;
  name: string;
  namespace?: string;
  label?: string;
  labelUpdatedAt?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  projectUpdatedAt?: string | null;
  projectObservedAt?: string;
  status: string;
  pid: number;
  cpu: number;
  memory: number;
  uptime: number | null;
  restarts: number;
  mode: string;
  version: string | null;
  ports: number[];
  portSource: "listening" | "configured" | null;
};

export type ProcessAction = "start" | "restart" | "stop" | "delete";
export type SaveProcessLabel = (
  process: Process,
  label: string,
) => Promise<void>;

function projectVersion(process: Process) {
  const updated = process.projectUpdatedAt || "";
  const observed = process.projectObservedAt || "";
  return updated > observed ? updated : observed;
}

export function mergeProcessLabels(incoming: Process[], current: Process[]) {
  const known = new Map(current.map((process) => [process.id, process]));
  return incoming.map((process) => {
    const previous = known.get(process.id);
    if (
      previous &&
      previous.name === process.name &&
      (previous.namespace || "default") === (process.namespace || "default")
    ) {
      if ((previous.labelUpdatedAt || "") > (process.labelUpdatedAt || ""))
        process = {
          ...process,
          label: previous.label,
          labelUpdatedAt: previous.labelUpdatedAt,
        };
      if (projectVersion(previous) > projectVersion(process))
        process = {
          ...process,
          projectId: previous.projectId,
          projectName: previous.projectName,
          projectUpdatedAt: previous.projectUpdatedAt,
          projectObservedAt: previous.projectObservedAt,
        };
    }
    return process;
  });
}

export const formatMemory = (bytes: number) =>
  `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function formatUptime(since: number | null) {
  if (!since) return "—";
  const seconds = Math.max(0, Math.floor((Date.now() - since) / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return days
    ? `${days}d ${hours}h`
    : hours
      ? `${hours}h ${minutes}m`
      : `${minutes}m`;
}

export type ProcessProjectActions = {
  onProjectEdit: (process: Process) => void;
  onOpenProject: (id: string) => void;
};
export type ProcessProjectLink = Pick<
  Process,
  "projectId" | "projectName" | "projectUpdatedAt"
> & { name: string; namespace: string };
