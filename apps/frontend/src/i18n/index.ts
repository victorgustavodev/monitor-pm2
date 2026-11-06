import { useEffect, useSyncExternalStore } from 'react';
import { messages } from './messages';
export type Locale = 'pt-BR' | 'en' | 'es';
const key = 'monitor-pm2:locale';
const listeners = new Set<() => void>();
let locale: Locale = 'pt-BR';
try { const saved = window.localStorage.getItem(key); if (saved === 'pt-BR' || saved === 'en' || saved === 'es') locale = saved; } catch { /* Storage is optional. */ }
export const getLocale = () => locale;
export const dateLocale = () => locale === 'en' ? 'en-US' : locale === 'es' ? 'es-ES' : 'pt-BR';
export function setLocale(value: Locale) {
  if (!['pt-BR', 'en', 'es'].includes(value)) return;
  locale = value;
  document.documentElement.lang = value;
  try { window.localStorage.setItem(key, value); } catch { /* Keep the choice in memory. */ }
  listeners.forEach((listener) => listener());
}
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function useLocale() {
  const value = useSyncExternalStore(subscribe, getLocale, () => 'pt-BR' as Locale);
  useEffect(() => { document.documentElement.lang = value; }, [value]);
  return value;
}
// Portuguese source phrases are stable keys; unknown server diagnostics stay intact.
export function t(source: string, values?: Record<string, string | number | undefined>) {
  const translated = locale === 'pt-BR' ? source : messages[source]?.[locale] ?? source;
  return values ? translated.replace(/\{(\w+)\}/g, (match, name: string) => String(values[name] ?? match)) : translated;
}
