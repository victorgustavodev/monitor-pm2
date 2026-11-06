import { dateLocale } from '../../i18n';
export type Project = {
  _id: string;
  name: string;
  description: string;
  rootPath: string;
  pm2ConfigPath: string;
  pathToRunPm2: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  buildCount: number;
  nextBuildNumber: number;
  activeBuildId?: string;
  deploying: boolean;
  deploymentError?: string;
};

export type ProjectBuild = {
  _id: string;
  projectId: string;
  projectName: string;
  name: string;
  number: number;
  comments: string;
  createdBy: string;
  createdAt: string;
  originalName: string;
  size: number;
  status: "processing" | "ready" | "deploying" | "deployed" | "failed" | "deleting";
  archiveReady: boolean;
  extracted: boolean;
  fileCount?: number;
  deployedAt?: string;
  deployedBy?: string;
  error?: string;
  active: boolean;
};

export type BuildPage = {
  items: ProjectBuild[];
  total: number;
  page: number;
  pageSize: number;
};
export type FileEntry = {
  name: string;
  path: string;
  type: "directory" | "file" | "blocked";
  size: number;
  modifiedAt: string | null;
};
export type FileView =
  | {
      type: "directory";
      path: string;
      entries: FileEntry[];
      truncated: boolean;
    }
  | {
      type: "file";
      path: string;
      size: number;
      modifiedAt: string;
      binary: boolean;
      content: string | null;
      truncated: boolean;
    };

export const archiveAccept =
  ".zip,.rar,.7z,.tar,.tar.gz,.tgz,.tar.bz2,.tbz2,.tbz,.tar.xz,.txz";
export const dateTime = (value: string) =>
  new Date(value).toLocaleString(dateLocale());
export function fileSize(bytes: number) {
  return bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
