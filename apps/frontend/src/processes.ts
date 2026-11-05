export type Process = {
  id: number;
  name: string;
  status: string;
  pid: number;
  cpu: number;
  memory: number;
  uptime: number | null;
  restarts: number;
  mode: string;
  version: string | null;
  ports: number[];
  portSource: 'listening' | 'configured' | null;
};

export type ProcessAction = 'start' | 'restart' | 'stop' | 'delete';

export const formatMemory = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function formatUptime(since: number | null) {
  if (!since) return '—';
  const seconds = Math.max(0, Math.floor((Date.now() - since) / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}
