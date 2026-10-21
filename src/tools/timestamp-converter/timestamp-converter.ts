export type TimestampUnit = 'auto' | 'seconds' | 'milliseconds';
export type Resolved = 'seconds' | 'milliseconds';

/** Límite del objeto Date de JavaScript: ±8,64·10¹⁵ milisegundos desde 1970. */
export const MAX_DATE_MS = 8.64e15;
/** En modo automático, valores con magnitud >= 1e11 se tratan como milisegundos (desde marzo de 1973). */
export const AUTO_MS_THRESHOLD = 1e11;

// Las fechas legibles solo se muestran entre los años 1 y 9999 (con un día de margen por las zonas horarias):
// fuera de ahí Intl usa eras (a. C.) y daría resultados confusos.
const MIN_FRIENDLY_MS = -62135596800000 + 86_400_000;
const MAX_FRIENDLY_MS = 253402300799999 - 86_400_000;

export type Failure = { ok: false; error: string };

export interface ParsedTimestamp {
  ok: true;
  ms: number;
  interpretedAs: Resolved;
}

export function parseTimestamp(input: string, unit: TimestampUnit = 'auto'): ParsedTimestamp | Failure {
  const text = input.trim();
  if (text === '') return { ok: false, error: 'Escribe un timestamp para convertir.' };
  if (!/^[+-]?\d+(\.\d+)?$/.test(text)) {
    return { ok: false, error: 'El timestamp solo puede tener dígitos, un signo opcional y un punto decimal.' };
  }
  const n = Number(text);
  const interpretedAs: Resolved =
    unit === 'auto' ? (Math.abs(n) >= AUTO_MS_THRESHOLD ? 'milliseconds' : 'seconds') : unit;
  const ms = Math.round(interpretedAs === 'seconds' ? n * 1000 : n) + 0; // «+ 0» evita -0
  if (!Number.isFinite(ms) || Math.abs(ms) > MAX_DATE_MS) {
    return {
      ok: false,
      error:
        interpretedAs === 'seconds'
          ? 'El valor está fuera del rango de fechas que admite JavaScript. Si es un valor en milisegundos, elige «Milisegundos».'
          : 'El valor está fuera del rango de fechas que admite JavaScript.',
    };
  }
  return { ok: true, ms, interpretedAs };
}

export const toSeconds = (ms: number): number => Math.floor(ms / 1000);

export const toIsoUtc = (ms: number): string => new Date(ms).toISOString();

export function isValidTimeZone(zone: string): boolean {
  if (zone.trim() === '') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone.trim() });
    return true;
  } catch {
    return false;
  }
}

/** Lista de zonas IANA del navegador; vacía si no puede obtenerse. */
export function listTimeZones(): string[] {
  try {
    return typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  } catch {
    return [];
  }
}

export function getBrowserTimeZone(): string {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
}

interface Fields {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

function zoneParts(ms: number, zone: string) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'shortOffset',
  }).formatToParts(new Date(ms));
}

function zoneFields(ms: number, zone: string): Fields {
  const get = (type: string) => Number(zoneParts(ms, zone).find((p) => p.type === type)?.value);
  return { y: get('year'), mo: get('month'), d: get('day'), h: get('hour'), mi: get('minute'), s: get('second') };
}

/** Construye un instante UTC sin el problema de Date.UTC con años 0–99. */
function buildUtc(y: number, mo: number, d: number, h: number, mi: number, s: number, msec = 0): number {
  const dt = new Date(0);
  dt.setUTCFullYear(y, mo - 1, d);
  dt.setUTCHours(h, mi, s, msec);
  return dt.getTime();
}

/** Diferencia (ms) entre la hora de pared de la zona y UTC en un instante dado. */
function offsetMs(ms: number, zone: string): number {
  const f = zoneFields(ms, zone);
  return buildUtc(f.y, f.mo, f.d, f.h, f.mi, f.s) - Math.floor(ms / 1000) * 1000;
}

export interface ZonedText {
  zone: string;
  /** «2023-11-14 17:13:20 (GMT-5)» */
  text: string;
}

/** Fecha legible en una zona. Devuelve null si el año queda fuera de 1–9999 o la zona no es válida. */
export function formatInZone(ms: number, zone: string): ZonedText | null {
  if (ms < MIN_FRIENDLY_MS || ms > MAX_FRIENDLY_MS) return null;
  const z = zone.trim();
  if (!isValidTimeZone(z)) return null;
  const parts = zoneParts(ms, z);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const frac = ((ms % 1000) + 1000) % 1000;
  const fraction = frac === 0 ? '' : `.${String(frac).padStart(3, '0')}`;
  const offset = z.toUpperCase() === 'UTC' ? 'UTC' : get('timeZoneName');
  return {
    zone: z,
    text: `${get('year').padStart(4, '0')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}${fraction} (${offset})`,
  };
}

export interface ParsedDate {
  ok: true;
  ms: number;
  /** Cómo se interpretó la hora: «UTC», una zona IANA o un desplazamiento explícito. */
  interpretedIn: string;
}

const DATE_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,3}))?)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i;

/**
 * Convierte una fecha («AAAA-MM-DD», con hora opcional y desplazamiento opcional) a instante.
 * Sin desplazamiento explícito, la hora se interpreta en `zone` («UTC» o una zona IANA).
 */
export function parseDateTime(input: string, zone: string): ParsedDate | Failure {
  const text = input.trim();
  if (text === '') return { ok: false, error: 'Escribe una fecha para convertir.' };
  const m = DATE_RE.exec(text);
  if (!m) {
    return { ok: false, error: 'Formato no reconocido. Usa AAAA-MM-DD o AAAA-MM-DD HH:mm:ss, por ejemplo 2024-02-29 12:00:00.' };
  }
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4] ?? '0', m[5] ?? '0', m[6] ?? '0'].map(Number);
  const msec = m[7] ? Number(m[7].padEnd(3, '0')) : 0;

  if (y < 1) return { ok: false, error: 'Usa años entre 0001 y 9999.' };
  if (mo < 1 || mo > 12) return { ok: false, error: 'El mes debe estar entre 01 y 12.' };
  if (h > 23 || mi > 59 || s > 59) return { ok: false, error: 'La hora no es válida: usa horas 00–23, minutos y segundos 00–59.' };
  const wall = buildUtc(y, mo, d, h, mi, s, msec);
  const check = new Date(wall);
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
    return { ok: false, error: 'Esa fecha no existe en el calendario (por ejemplo, 30 de febrero).' };
  }

  if (m[8]) {
    const tz = m[8].toUpperCase();
    if (tz === 'Z') return { ok: true, ms: wall, interpretedIn: 'UTC' };
    const sign = tz[0] === '-' ? -1 : 1;
    const digits = tz.slice(1).replace(':', '');
    const oh = Number(digits.slice(0, 2));
    const om = Number(digits.slice(2) || '0');
    if (oh > 18 || om > 59) return { ok: false, error: 'El desplazamiento horario no es válido.' };
    return { ok: true, ms: wall - sign * (oh * 60 + om) * 60_000, interpretedIn: `UTC${tz}` };
  }

  const z = zone.trim();
  if (z.toUpperCase() === 'UTC') return { ok: true, ms: wall, interpretedIn: 'UTC' };
  if (!isValidTimeZone(z)) return { ok: false, error: `La zona horaria «${z}» no es válida. Usa un nombre IANA como America/Lima.` };

  // Dos pasadas bastan para resolver el desplazamiento; luego se verifica que la hora exista en la zona.
  let guess = wall - offsetMs(wall, z);
  guess = wall - offsetMs(guess, z);
  const back = zoneFields(guess, z);
  if (back.y !== y || back.mo !== mo || back.d !== d || back.h !== h || back.mi !== mi || back.s !== s) {
    return { ok: false, error: `Esa hora no existe en ${z} por el cambio de horario. Prueba con otra hora.` };
  }
  return { ok: true, ms: guess, interpretedIn: z };
}

export const TIMESTAMP_EXAMPLES = [
  { label: 'Segundos (2023)', value: '1700000000' },
  { label: 'Milisegundos', value: '1700000000000' },
  { label: 'Época Unix', value: '0' },
  { label: 'Negativo (1969)', value: '-86400' },
] as const;

export const DATE_EXAMPLES = [
  { label: 'Fecha con hora', value: '2024-02-29 12:00:00' },
  { label: 'ISO con Z', value: '2000-01-01T00:00:00Z' },
  { label: 'Solo fecha', value: '2030-12-31' },
] as const;
