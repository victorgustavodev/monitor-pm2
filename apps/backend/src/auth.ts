import type { NextFunction, Request, Response } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from './config';
import { HttpError } from './http-error';

const SESSION_SECONDS = 8 * 60 * 60;
const attempts = new Map<string, { count: number; resetAt: number }>();

function safeEqual(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function signature(value: string): string {
  return createHmac('sha256', env.jwtSecret).update(value).digest('base64url');
}

export function createSession(username: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: username,
    role: 'admin',
    exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS,
  })).toString('base64url');
  const unsigned = `${header}.${payload}`;
  return `${unsigned}.${signature(unsigned)}`;
}

function readSession(request: Request): string | undefined {
  const cookies = request.headers.cookie?.split(';') ?? [];
  for (const cookie of cookies) {
    const separator = cookie.indexOf('=');
    if (separator < 0) continue;
    if (cookie.slice(0, separator).trim() === 'pm2_session') {
      return decodeURIComponent(cookie.slice(separator + 1).trim());
    }
  }
}

function verifySession(token: string): boolean {
  try {
    const [header, payload, tokenSignature, extra] = token.split('.');
    if (!header || !payload || !tokenSignature || extra) return false;
    const expected = signature(`${header}.${payload}`);
    if (!safeEqual(tokenSignature, expected)) return false;
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: number; role?: string };
    return claims.role === 'admin' && typeof claims.exp === 'number' && claims.exp > Date.now() / 1000;
  } catch {
    return false;
  }
}

export function authenticate(request: Request, _response: Response, next: NextFunction) {
  const token = readSession(request);
  if (!token) return next(new HttpError(401, 'Sessão não encontrada.'));
  if (!verifySession(token)) return next(new HttpError(401, 'Sessão inválida ou expirada.'));
  next();
}

export function validateLogin(ip: string, username: unknown, password: unknown): string {
  const now = Date.now();
  const current = attempts.get(ip);
  if (current && current.resetAt > now && current.count >= 5) {
    throw new HttpError(429, 'Muitas tentativas. Aguarde 15 minutos.');
  }
  if (
    typeof username !== 'string' || typeof password !== 'string' ||
    !safeEqual(username, env.adminUsername) || !safeEqual(password, env.adminPassword)
  ) {
    const next = current && current.resetAt > now
      ? { ...current, count: current.count + 1 }
      : { count: 1, resetAt: now + 15 * 60_000 };
    attempts.set(ip, next);
    throw new HttpError(401, 'Usuário ou senha inválidos.');
  }
  attempts.delete(ip);
  return username;
}

export const sessionCookie = {
  httpOnly: true,
  sameSite: 'strict' as const,
  secure: env.cookieSecure,
  maxAge: SESSION_SECONDS * 1000,
  path: '/',
};
