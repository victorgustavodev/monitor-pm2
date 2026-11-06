import type { NextFunction, Request, Response } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../common/config";
import { HttpError } from "../common/http-error";
import { users } from "../common/database";
import { verifyPassword, hashPassword } from "./password";

const SESSION_SECONDS = 8 * 60 * 60;
const attempts = new Map<string, { count: number; resetAt: number }>();
const dummyHash = hashPassword("invalid-user-timing-placeholder");

function safeEqual(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function signature(value: string): string {
  return createHmac("sha256", env.jwtSecret).update(value).digest("base64url");
}

export function createSession(username: string): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      sub: username,
      role: "admin",
      exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS,
    }),
  ).toString("base64url");
  const unsigned = `${header}.${payload}`;
  return `${unsigned}.${signature(unsigned)}`;
}

function readSession(request: Request): string | undefined {
  const cookies = request.headers.cookie?.split(";") ?? [];
  for (const cookie of cookies) {
    const separator = cookie.indexOf("=");
    if (separator < 0) continue;
    if (cookie.slice(0, separator).trim() === "pm2_session") {
      return decodeURIComponent(cookie.slice(separator + 1).trim());
    }
  }
}

function verifySession(
  token: string,
): { username: string; expiresAt: number } | undefined {
  try {
    const [header, payload, tokenSignature, extra] = token.split(".");
    if (!header || !payload || !tokenSignature || extra) return;
    const expected = signature(`${header}.${payload}`);
    if (!safeEqual(tokenSignature, expected)) return;
    const claims = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as { exp?: number; role?: string; sub?: string };
    if (
      claims.role === "admin" &&
      typeof claims.sub === "string" &&
      typeof claims.exp === "number" &&
      claims.exp > Date.now() / 1000
    ) {
      return { username: claims.sub, expiresAt: claims.exp * 1000 };
    }
  } catch {
    return;
  }
}

export async function authenticate(
  request: Request,
  response: Response,
  next: NextFunction,
) {
  let token: string | undefined;
  try {
    token = readSession(request);
  } catch {
    return next(new HttpError(401, "Cookie de sessão inválido."));
  }
  if (!token) return next(new HttpError(401, "Sessão não encontrada."));
  const session = verifySession(token);
  if (
    !session ||
    !(await users.findOne(
      { username: session.username },
      { projection: { _id: 1 } },
    ))
  )
    return next(new HttpError(401, "Sessão inválida ou expirada."));
  response.locals.username = session.username;
  response.locals.sessionExpiresAt = session.expiresAt;
  next();
}

export async function validateLogin(
  ip: string,
  username: unknown,
  password: unknown,
): Promise<string> {
  const now = Date.now();
  for (const [key, value] of attempts)
    if (value.resetAt <= now) attempts.delete(key);
  const current = attempts.get(ip);
  if (current && current.resetAt > now && current.count >= 5) {
    throw new HttpError(429, "Muitas tentativas. Aguarde 15 minutos.");
  }
  const normalized =
    typeof username === "string" ? username.trim().toLowerCase() : "";
  const user =
    normalized && normalized.length <= 64
      ? await users.findOne({ username: normalized })
      : null;
  const valid =
    typeof password === "string" &&
    password.length <= 256 &&
    (await verifyPassword(password, user?.passwordHash ?? (await dummyHash)));
  if (!user || !valid) {
    const next =
      current && current.resetAt > now
        ? { ...current, count: current.count + 1 }
        : { count: 1, resetAt: now + 15 * 60_000 };
    attempts.set(ip, next);
    throw new HttpError(401, "Usuário ou senha inválidos.");
  }
  attempts.delete(ip);
  return user.username;
}

export const sessionCookie = {
  httpOnly: true,
  sameSite: "strict" as const,
  secure: env.cookieSecure,
  maxAge: SESSION_SECONDS * 1000,
  path: "/",
};
