import { describe, expect, it } from 'vitest';
import {
  MAX_DATE_MS,
  formatInZone,
  isValidTimeZone,
  parseDateTime,
  parseTimestamp,
  toIsoUtc,
  toSeconds,
} from './timestamp-converter';

const ok = <T extends { ok: boolean }>(r: T) => {
  expect(r.ok).toBe(true);
  return r as Extract<T, { ok: true }>;
};

describe('parseTimestamp', () => {
  it('detecta segundos y milisegundos en modo automático', () => {
    expect(ok(parseTimestamp('1700000000'))).toMatchObject({ ms: 1700000000000, interpretedAs: 'seconds' });
    expect(ok(parseTimestamp('1700000000000'))).toMatchObject({ ms: 1700000000000, interpretedAs: 'milliseconds' });
  });

  it('respeta la unidad elegida aunque la heurística diga otra cosa', () => {
    expect(ok(parseTimestamp('1700000000000', 'milliseconds')).ms).toBe(1700000000000);
    expect(ok(parseTimestamp('1000', 'milliseconds')).ms).toBe(1000);
    expect(ok(parseTimestamp('1000', 'seconds')).ms).toBe(1_000_000);
  });

  it('acepta 0, valores negativos y signo +', () => {
    expect(ok(parseTimestamp('0')).ms).toBe(0);
    expect(ok(parseTimestamp('-86400')).ms).toBe(-86_400_000);
    expect(ok(parseTimestamp('+5')).ms).toBe(5000);
    expect(Object.is(ok(parseTimestamp('-0')).ms, -0)).toBe(false);
  });

  it('acepta decimales en segundos', () => {
    expect(ok(parseTimestamp('1700000000.123')).ms).toBe(1700000000123);
    expect(ok(parseTimestamp('-1.5')).ms).toBe(-1500);
  });

  it('ignora espacios alrededor', () => {
    expect(ok(parseTimestamp('  42  ')).ms).toBe(42_000);
  });

  it.each(['', '   ', 'abc', '12abc', '1e9', '1,5', '--1', '0x10', '1.'])('rechaza %j', (v) => {
    expect(parseTimestamp(v).ok).toBe(false);
  });

  it('respeta el límite de Date', () => {
    expect(ok(parseTimestamp(String(MAX_DATE_MS), 'milliseconds')).ms).toBe(MAX_DATE_MS);
    expect(ok(parseTimestamp(String(-MAX_DATE_MS), 'milliseconds')).ms).toBe(-MAX_DATE_MS);
    expect(parseTimestamp(String(MAX_DATE_MS + 1), 'milliseconds').ok).toBe(false);
    expect(parseTimestamp('99999999999999999999').ok).toBe(false);
    expect(() => toIsoUtc(MAX_DATE_MS)).not.toThrow();
  });

  it('sugiere milisegundos cuando un valor en segundos se sale de rango', () => {
    const r = parseTimestamp('9999999999999999', 'seconds');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Milisegundos/);
  });
});

describe('formato', () => {
  it('toIsoUtc y toSeconds', () => {
    expect(toIsoUtc(1700000000000)).toBe('2023-11-14T22:13:20.000Z');
    expect(toSeconds(1700000000999)).toBe(1700000000);
    expect(toSeconds(-1)).toBe(-1); // suelo, no truncamiento
    expect(toIsoUtc(0)).toBe('1970-01-01T00:00:00.000Z');
  });

  it('formatInZone en UTC y en zonas con y sin horario de verano', () => {
    expect(formatInZone(1700000000000, 'UTC')?.text).toBe('2023-11-14 22:13:20 (UTC)');
    expect(formatInZone(1700000000000, 'America/Lima')?.text).toBe('2023-11-14 17:13:20 (GMT-5)');
    expect(formatInZone(1700000000000, 'America/New_York')?.text).toBe('2023-11-14 17:13:20 (GMT-5)');
    // Julio: Nueva York en horario de verano
    expect(formatInZone(1690000000000, 'America/New_York')?.text).toBe('2023-07-22 00:26:40 (GMT-4)');
    expect(formatInZone(1700000000000, 'Asia/Kolkata')?.text).toBe('2023-11-15 03:43:20 (GMT+5:30)');
  });

  it('muestra milisegundos solo si existen, también con negativos', () => {
    expect(formatInZone(1700000000123, 'UTC')?.text).toBe('2023-11-14 22:13:20.123 (UTC)');
    expect(formatInZone(-1, 'UTC')?.text).toBe('1969-12-31 23:59:59.999 (UTC)');
  });

  it('devuelve null fuera de los años 1–9999 o con zona inválida', () => {
    expect(formatInZone(MAX_DATE_MS, 'UTC')).toBeNull();
    expect(formatInZone(-MAX_DATE_MS, 'UTC')).toBeNull();
    expect(formatInZone(0, 'No/Existe')).toBeNull();
  });
});

describe('isValidTimeZone', () => {
  it('valida nombres IANA', () => {
    expect(isValidTimeZone('America/Bogota')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone('   ')).toBe(false);
  });
});

describe('parseDateTime', () => {
  it('interpreta en UTC', () => {
    expect(ok(parseDateTime('2023-11-14 22:13:20', 'UTC')).ms).toBe(1700000000000);
    expect(ok(parseDateTime('2023-11-14T22:13:20', 'UTC')).ms).toBe(1700000000000);
    expect(ok(parseDateTime('1970-01-01', 'UTC')).ms).toBe(0);
    expect(ok(parseDateTime('2023-11-14 22:13', 'UTC')).ms).toBe(1700000000000 - 20_000);
  });

  it('interpreta en una zona IANA', () => {
    expect(ok(parseDateTime('2023-11-14 17:13:20', 'America/Lima')).ms).toBe(1700000000000);
    expect(ok(parseDateTime('2023-07-22 00:26:40', 'America/New_York')).ms).toBe(1690000000000);
  });

  it('el desplazamiento explícito manda sobre la zona', () => {
    expect(ok(parseDateTime('2023-11-14T22:13:20Z', 'America/Lima')).ms).toBe(1700000000000);
    expect(ok(parseDateTime('2023-11-14T17:13:20-05:00', 'UTC')).ms).toBe(1700000000000);
    expect(ok(parseDateTime('2023-11-15T03:43:20+0530', 'UTC')).ms).toBe(1700000000000);
    expect(ok(parseDateTime('2023-11-14T17:13:20-05', 'UTC')).ms).toBe(1700000000000);
  });

  it('lee milisegundos con 1 a 3 dígitos', () => {
    expect(ok(parseDateTime('2023-11-14 22:13:20.5', 'UTC')).ms).toBe(1700000000500);
    expect(ok(parseDateTime('2023-11-14 22:13:20.123', 'UTC')).ms).toBe(1700000000123);
  });

  it('acepta el 29 de febrero solo en años bisiestos', () => {
    expect(parseDateTime('2024-02-29', 'UTC').ok).toBe(true);
    expect(parseDateTime('2023-02-29', 'UTC').ok).toBe(false);
    expect(parseDateTime('1900-02-29', 'UTC').ok).toBe(false);
    expect(parseDateTime('2000-02-29', 'UTC').ok).toBe(true);
  });

  it.each([
    '2023-02-30',
    '2023-13-01',
    '2023-00-10',
    '2023-04-31',
    '2023-01-01 24:00:00',
    '2023-01-01 10:60:00',
    '2023-01-01 10:00:60',
    '0000-01-01',
    '23-01-01',
    '2023/01/01',
    'ayer',
    '',
  ])('rechaza %j', (v) => {
    expect(parseDateTime(v, 'UTC').ok).toBe(false);
  });

  it('rechaza zonas inválidas', () => {
    const r = parseDateTime('2023-01-01', 'Mars/Olympus');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/zona horaria/);
  });

  it('detecta una hora que no existe por el cambio de horario', () => {
    const r = parseDateTime('2024-03-10 02:30:00', 'America/New_York');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/no existe/);
  });

  it('resuelve una hora ambigua sin fallar', () => {
    const r = ok(parseDateTime('2024-11-03 01:30:00', 'America/New_York'));
    expect(formatInZone(r.ms, 'America/New_York')?.text).toMatch(/^2024-11-03 01:30:00/);
  });

  it('hace ida y vuelta con formatInZone', () => {
    for (const zone of ['UTC', 'America/Lima', 'Europe/Madrid', 'Asia/Tokyo', 'Australia/Lord_Howe']) {
      const ms = 1_720_000_000_000;
      const text = formatInZone(ms, zone)!.text.split(' (')[0];
      expect(ok(parseDateTime(text, zone)).ms).toBe(ms);
    }
  });

  it('maneja años anteriores a 100', () => {
    expect(ok(parseDateTime('0050-06-15', 'UTC')).ms).toBe(new Date('0050-06-15T00:00:00Z').getTime());
  });
});
