import type { ObjectId } from "mongodb";
import { HttpError } from "../common/http-error";
import { activeBuildOperation } from "./build-progress";

const busyProjects = new Set<string>();
let configuring = false;

export async function withProjectOperation<T>(
  id: ObjectId,
  action: () => Promise<T>,
  operationId?: string,
) {
  const key = id.toHexString();
  const publication = activeBuildOperation(key);
  if (busyProjects.has(key) || (publication && publication.state.id !== operationId))
    throw new HttpError(
      409,
      "Já existe uma operação em andamento neste projeto. Aguarde a conclusão.",
    );
  busyProjects.add(key);
  try {
    return await action();
  } finally {
    busyProjects.delete(key);
  }
}

export function isProjectOperationBusy(id: string) { return busyProjects.has(id); }

export async function withProjectConfiguration<T>(action: () => Promise<T>) {
  if (configuring)
    throw new HttpError(
      409,
      "Aguarde a conclusão da outra alteração de projeto.",
    );
  configuring = true;
  try {
    return await action();
  } finally {
    configuring = false;
  }
}
