import { join } from 'node:path';

/**
 * Construye la ruta del archivo de log para una corrida.
 *
 * Formato (per `specs/persistencia-datos §Log Rotation Per Run`):
 *   `<dataDir>/logs/<ISO8601-compact-en-UTC>.log`
 *
 *   ej: 2026-06-29T143022Z -> `data/logs/2026-06-29T143022Z.log`
 *
 * Compacto a segundos (sin `:` ni `.`) para mantener el nombre
 * portable entre sistemas. UTC estable: nuevas corridas producen
 * archivos distintos aunque la maquina tenga TZ variable.
 */
export function buildLogPath(startedAt: Date, dataDir: string): string {
  const stamp = formatIsoCompact(startedAt);
  return join(dataDir, 'logs', `${stamp}.log`);
}

/** `YYYY-MM-DDTHHMMSSZ` en UTC. */
export function formatIsoCompact(d: Date): string {
  const pad = (n: number): string => n.toString().padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  const mm = pad(d.getUTCMonth() + 1);
  const dd = pad(d.getUTCDate());
  const hh = pad(d.getUTCHours());
  const mi = pad(d.getUTCMinutes());
  const ss = pad(d.getUTCSeconds());
  return `${yyyy}-${mm}-${dd}T${hh}${mi}${ss}Z`;
}
