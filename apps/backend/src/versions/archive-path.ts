import { HttpError } from '../common/http-error';

// Validação independente do SO: os builds também serão extraídos no Windows.
export function archivePath(name: string): string {
  const normalized = name.replace(/\\/g, '/').replace(/\/$/, '');
  const segments = normalized.split('/');
  if (!normalized || segments.some((segment) =>
    !segment || segment === '.' || segment === '..' || /[<>:"|?*\x00-\x1f]/.test(segment) ||
    /[. ]$/.test(segment) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment)
  )) throw new HttpError(400, 'O RAR contém um caminho inválido ou fora da pasta do build.');
  return segments.join('/');
}
