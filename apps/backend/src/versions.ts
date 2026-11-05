import multer from 'multer';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import { MongoServerError, ObjectId } from 'mongodb';
import { env } from './config';
import { versions, type VersionRecord } from './database';
import { archivePath } from './archive-path';
import { HttpError } from './http-error';
import { deployEcosystem } from './pm2';

export const uploadBuild = multer({
  dest: resolve(env.versionsPath, '.uploads'),
  limits: { fileSize: env.uploadMaxBytes, files: 1, fields: 2, fieldSize: 256, parts: 3 },
  fileFilter: (_request, file, callback) => {
    if (extname(file.originalname).toLowerCase() !== '.rar') return callback(new HttpError(400, 'Envie um arquivo .rar.'));
    callback(null, true);
  },
}).single('build');

function label(value: unknown, name: string): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(value.trim())) {
    throw new HttpError(400, `${name} deve ter até 80 caracteres: letras, números, ponto, hífen ou sublinhado.`);
  }
  return archivePath(value.trim().toLowerCase());
}

export function versionId(raw: unknown): ObjectId {
  if (typeof raw !== 'string' || !/^[a-f0-9]{24}$/.test(raw)) throw new HttpError(400, 'ID de versão inválido.');
  return new ObjectId(raw);
}

export function versionFolder(id: ObjectId): string {
  return resolve(env.versionsPath, id.toHexString());
}

async function extractBuild(archive: string, target: string): Promise<{ ecosystem?: string }> {
  const workerPath = resolve(__dirname, `archive-worker${extname(__filename)}`);
  const worker = new Worker(workerPath, {
    workerData: { archive, target, maxBytes: env.extractedMaxBytes },
    ...(extname(__filename) === '.ts' ? { execArgv: ['--require', require.resolve('tsx/cjs')] } : {}),
  });
  try {
    return await new Promise((resolveResult, reject) => {
      const timer = setTimeout(() => reject(new HttpError(400, 'O RAR excedeu o tempo máximo de extração (2 minutos).')), 120_000);
      worker.once('message', (result: { error?: string; ecosystem?: string }) => {
        clearTimeout(timer);
        if (result.error) reject(new HttpError(400, `Não foi possível extrair o RAR: ${result.error}`));
        else resolveResult(result);
      });
      worker.once('error', (error) => { clearTimeout(timer); reject(error); });
      worker.once('exit', () => { clearTimeout(timer); reject(new HttpError(400, 'Extração do RAR interrompida.')); });
    });
  } finally {
    await worker.terminate();
  }
}

export async function saveBuild(file: Express.Multer.File | undefined, body: Record<string, unknown> | undefined, username: string) {
  if (!file) throw new HttpError(400, 'Selecione o arquivo .rar do build.');
  const id = new ObjectId();
  let reserved = false;
  try {
    const project = label(body?.project, 'Projeto');
    const version = label(body?.version, 'Versão');
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(file.path)) hash.update(chunk);
    const record: VersionRecord = {
      project, version, originalName: file.originalname, size: file.size,
      sha256: hash.digest('hex'), createdAt: new Date(), createdBy: username, status: 'processing',
    };
    await versions.insertOne({ ...record, _id: id });
    reserved = true;
    const directory = versionFolder(id);
    await mkdir(directory, { recursive: true });
    const archive = resolve(directory, 'build.rar');
    await rename(file.path, archive);
    const extracted = await extractBuild(archive, resolve(directory, 'build'));
    const ready = { status: 'ready' as const, ...(extracted.ecosystem ? { ecosystem: extracted.ecosystem } : {}) };
    await versions.updateOne({ _id: id }, { $set: ready });
    return { ...record, ...ready, _id: id };
  } catch (error) {
    if (reserved) {
      await versions.deleteOne({ _id: id });
      await rm(versionFolder(id), { recursive: true, force: true });
    }
    if (error instanceof MongoServerError && error.code === 11000) throw new HttpError(409, 'Este projeto já possui essa versão. Envie uma nova versão.');
    throw error;
  } finally {
    await rm(file.path, { force: true });
  }
}

let deploying = false;
export async function startVersion(id: ObjectId) {
  if (deploying) throw new HttpError(409, 'Aguarde a inicialização da outra versão.');
  deploying = true;
  try {
    const version = await versions.findOne({ _id: id });
    if (!version) throw new HttpError(404, 'Versão não encontrada.');
    if (!version.ecosystem || !['ready', 'started', 'failed'].includes(version.status)) {
      throw new HttpError(400, 'O build deve conter exatamente um ecosystem.config.js para iniciar pelo painel.');
    }
    await versions.updateOne({ _id: id }, { $set: { status: 'starting' }, $unset: { error: '' } });
    try {
      await deployEcosystem(resolve(versionFolder(id), 'build', version.ecosystem));
      await versions.updateOne({ _id: id }, { $set: { status: 'started', startedAt: new Date() } });
    } catch (error) {
      await versions.updateOne({ _id: id }, { $set: { status: 'failed', error: error instanceof Error ? error.message : 'Falha no PM2.' } });
      throw error;
    }
  } finally { deploying = false; }
}
