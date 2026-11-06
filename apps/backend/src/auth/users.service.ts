import { MongoServerError } from "mongodb";
import { env } from "../common/config";
import { publicUser, users } from "../common/database";
import { HttpError } from "../common/http-error";
import { hashPassword } from "./password";

export function normalizeUsername(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[a-zA-Z0-9_.-]{3,64}$/.test(value.trim())
  ) {
    throw new HttpError(
      400,
      "Usuário deve ter de 3 a 64 caracteres: letras, números, ponto, hífen ou sublinhado.",
    );
  }
  return value.trim().toLowerCase();
}

export async function createUser(username: unknown, password: unknown) {
  const normalized = normalizeUsername(username);
  if (
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 256
  ) {
    throw new HttpError(400, "A senha deve ter de 12 a 256 caracteres.");
  }
  const user = {
    username: normalized,
    passwordHash: await hashPassword(password),
    createdAt: new Date(),
  };
  try {
    const result = await users.insertOne(user);
    return publicUser({ ...user, _id: result.insertedId });
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000)
      throw new HttpError(409, "Usuário já existe.");
    throw error;
  }
}

export async function bootstrapUser() {
  if (await users.findOne({})) return;
  if (!env.adminUsername || !env.adminPassword) {
    throw new Error(
      "Banco sem usuários. Configure ADMIN_USERNAME e ADMIN_PASSWORD para criar o primeiro usuário.",
    );
  }
  await createUser(env.adminUsername, env.adminPassword);
}
