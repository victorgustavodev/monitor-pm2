import { HttpError } from "./http-error";

// A single backend instance owns publication and retention jobs.
let readers = 0;
let cleaning = false;

export async function withArtifactAccess<T>(
  action: () => Promise<T>,
): Promise<T> {
  if (cleaning)
    throw new HttpError(
      409,
      "A limpeza de versões está em andamento. Tente novamente em instantes.",
    );
  readers++;
  try {
    return await action();
  } finally {
    readers--;
  }
}

export async function tryArtifactCleanup(action: () => Promise<void>) {
  if (cleaning || readers > 0) return false;
  cleaning = true;
  try {
    await action();
    return true;
  } finally {
    cleaning = false;
  }
}
