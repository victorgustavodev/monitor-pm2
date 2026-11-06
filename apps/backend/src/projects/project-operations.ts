import type { ObjectId } from "mongodb";
import { HttpError } from "../common/http-error";

const busyProjects = new Set<string>();
let configuring = false;

export async function withProjectOperation<T>(
  id: ObjectId,
  action: () => Promise<T>,
) {
  const key = id.toHexString();
  if (busyProjects.has(key))
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
