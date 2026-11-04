import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const localEnv = resolve(process.cwd(), '.env');
const workspaceEnv = resolve(process.cwd(), '..', '..', '.env');
loadEnv({ path: existsSync(localEnv) ? localEnv : workspaceEnv, quiet: true });

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Variável obrigatória ausente: ${name}`);
  return value;
}

const adminPassword = required('ADMIN_PASSWORD');
const jwtSecret = required('JWT_SECRET');
if (adminPassword.length < 12) throw new Error('ADMIN_PASSWORD deve ter pelo menos 12 caracteres.');
if (jwtSecret.length < 32) throw new Error('JWT_SECRET deve ter pelo menos 32 caracteres.');

export const env = Object.freeze({
  adminUsername: required('ADMIN_USERNAME'),
  adminPassword,
  jwtSecret,
  host: process.env.HOST?.trim() || '0.0.0.0',
  port: Number(process.env.PORT || 4170),
  vpnAllowedCidrs: process.env.VPN_ALLOWED_CIDRS?.trim() || '127.0.0.1/32,::1/128',
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  pm2Home: process.env.PM2_HOME?.trim() || undefined,
  pm2Script: process.env.PM2_SCRIPT?.trim() || require.resolve('pm2/bin/pm2'),
});

if (!Number.isInteger(env.port) || env.port < 1 || env.port > 65_535) {
  throw new Error('PORT deve ser um número entre 1 e 65535.');
}
