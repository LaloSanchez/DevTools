import { useEffect, useId, useState } from 'react';
import CopyRow from '../../components/CopyRow';
import { button, errorBox, field, muted, primary } from '../../components/ui';
import {
  DATE_EXAMPLES,
  TIMESTAMP_EXAMPLES,
  formatInZone,
  getBrowserTimeZone,
  isValidTimeZone,
  listTimeZones,
  parseDateTime,
  parseTimestamp,
  toIsoUtc,
  toSeconds,
  type TimestampUnit,
} from './timestamp-converter';

type Row = { label: string; value: string };
type Outcome = { kind: 'error'; message: string } | { kind: 'ok'; rows: Row[]; note?: string };
type DateMode = 'utc' | 'local' | 'zone';

export default function TimestampConverter() {
  const ids = { ts: useId(), unit: useId(), zone: useId(), zoneHelp: useId(), date: useId(), mode: useId(), list: useId() };
  const [zone, setZone] = useState('');
  const [tsInput, setTsInput] = useState('');
  const [unit, setUnit] = useState<TimestampUnit>('auto');
  const [dateInput, setDateInput] = useState('');
  const [mode, setMode] = useState<DateMode>('utc');
  const [tsOut, setTsOut] = useState<Outcome | null>(null);
  const [dateOut, setDateOut] = useState<Outcome | null>(null);
  // Se calculan tras montar: en el servidor (compilación) la zona local sería la de la máquina de build.
  const [browserZone, setBrowserZone] = useState('');
  const [zones, setZones] = useState<string[]>([]);

  useEffect(() => {
    setBrowserZone(getBrowserTimeZone());
    setZones(listTimeZones());
  }, []);

  const zoneTrimmed = zone.trim();
  const zoneInvalid = zoneTrimmed !== '' && !isValidTimeZone(zoneTrimmed);

  function convertTimestamp(value: string, u: TimestampUnit) {
    const r = parseTimestamp(value, u);
    if (!r.ok) return setTsOut({ kind: 'error', message: r.error });
    const rows: Row[] = [{ label: 'Interpretado como', value: r.interpretedAs === 'seconds' ? 'segundos' : 'milisegundos' }];
    rows.push({ label: 'UTC (ISO 8601)', value: toIsoUtc(r.ms) });
    const utc = formatInZone(r.ms, 'UTC');
    if (utc) rows.push({ label: 'UTC', value: utc.text });
    const local = browserZone ? formatInZone(r.ms, browserZone) : null;
    if (local) rows.push({ label: `Hora local (${browserZone})`, value: local.text });
    const custom = zoneTrimmed && !zoneInvalid ? formatInZone(r.ms, zoneTrimmed) : null;
    if (custom) rows.push({ label: `Zona (${custom.zone})`, value: custom.text });
    rows.push({ label: 'Segundos', value: String(toSeconds(r.ms)) });
    rows.push({ label: 'Milisegundos', value: String(r.ms) });
    setTsOut({
      kind: 'ok',
      rows,
      note: utc ? undefined : 'La fecha queda fuera de los años 1–9999: solo se muestra la fecha ISO en UTC.',
    });
  }

  function convertDate(value: string, m: DateMode) {
    if (m === 'zone' && (zoneTrimmed === '' || zoneInvalid)) {
      return setDateOut({ kind: 'error', message: 'Indica una zona horaria IANA válida (por ejemplo America/Lima) o elige otra opción.' });
    }
    const effective = m === 'utc' ? 'UTC' : m === 'local' ? browserZone || 'UTC' : zoneTrimmed;
    const r = parseDateTime(value, effective);
    if (!r.ok) return setDateOut({ kind: 'error', message: r.error });
    setDateOut({
      kind: 'ok',
      rows: [
        { label: 'Interpretada en', value: r.interpretedIn },
        { label: 'Segundos', value: String(toSeconds(r.ms)) },
        { label: 'Milisegundos', value: String(r.ms) },
        { label: 'UTC (ISO 8601)', value: toIsoUtc(r.ms) },
      ],
    });
  }

  function now() {
    const v = String(Date.now());
    setTsInput(v);
    setUnit('auto');
    convertTimestamp(v, 'auto');
  }

  return (
    <div className="space-y-8">
      <div>
        <label htmlFor={ids.zone} className="block text-sm font-medium">
          Zona horaria (opcional)
        </label>
        <input
          id={ids.zone}
          list={zones.length ? ids.list : undefined}
          value={zone}
          onChange={(e) => setZone(e.target.value)}
          placeholder="Ej: America/Lima"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={zoneInvalid}
          aria-describedby={ids.zoneHelp}
          className={`mt-1 w-full max-w-sm ${field}`}
        />
        {zones.length > 0 && (
          <datalist id={ids.list}>
            {zones.map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
        )}
        <p id={ids.zoneHelp} className={`mt-1 text-xs ${zoneInvalid ? 'text-red-700 dark:text-red-400' : muted}`}>
          {zoneInvalid
            ? 'Esa zona horaria no es válida. Usa un nombre IANA como America/Bogota o Europe/Madrid.'
            : `Se muestra además de UTC${browserZone ? ` y de tu hora local (${browserZone})` : ' y de tu hora local'}.`}
        </p>
      </div>

      <section aria-labelledby={`${ids.ts}-h`} className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
        <h2 id={`${ids.ts}-h`} className="text-lg font-semibold">
          Timestamp a fecha
        </h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            convertTimestamp(tsInput, unit);
          }}
          className="mt-3 flex flex-wrap items-end gap-3">
          <div className="min-w-48 flex-1">
            <label htmlFor={ids.ts} className="block text-sm font-medium">
              Timestamp Unix
            </label>
            <input
              id={ids.ts}
              value={tsInput}
              onChange={(e) => setTsInput(e.target.value)}
              inputMode="numeric"
              autoComplete="off"
              placeholder="Ej: 1700000000"
              className={`mt-1 w-full font-mono ${field}`}
            />
          </div>
          <div>
            <label htmlFor={ids.unit} className="block text-sm font-medium">
              Unidad
            </label>
            <select id={ids.unit} value={unit} onChange={(e) => setUnit(e.target.value as TimestampUnit)} className={`mt-1 ${field}`}>
              <option value="auto">Automática</option>
              <option value="seconds">Segundos</option>
              <option value="milliseconds">Milisegundos</option>
            </select>
          </div>
          <button type="submit" className={primary}>
            Convertir
          </button>
          <button type="button" className={button} onClick={now}>
            Ahora
          </button>
        </form>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">Ejemplos:</span>
          {TIMESTAMP_EXAMPLES.map((ex) => (
            <button
              key={ex.label}
              type="button"
              className={button}
              onClick={() => {
                setTsInput(ex.value);
                setUnit('auto');
                convertTimestamp(ex.value, 'auto');
              }}
            >
              {ex.label}
            </button>
          ))}
        </div>
        <Result outcome={tsOut} />
      </section>

      <section aria-labelledby={`${ids.date}-h`} className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
        <h2 id={`${ids.date}-h`} className="text-lg font-semibold">
          Fecha a timestamp
        </h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            convertDate(dateInput, mode);
          }}
          className="mt-3 flex flex-wrap items-end gap-3">
          <div className="min-w-48 flex-1">
            <label htmlFor={ids.date} className="block text-sm font-medium">
              Fecha y hora
            </label>
            <input
              id={ids.date}
              value={dateInput}
              onChange={(e) => setDateInput(e.target.value)}
              autoComplete="off"
              placeholder="AAAA-MM-DD HH:mm:ss"
              className={`mt-1 w-full font-mono ${field}`}
            />
          </div>
          <div>
            <label htmlFor={ids.mode} className="block text-sm font-medium">
              Interpretar en
            </label>
            <select id={ids.mode} value={mode} onChange={(e) => setMode(e.target.value as DateMode)} className={`mt-1 ${field}`}>
              <option value="utc">UTC</option>
              <option value="local">Mi hora local</option>
              <option value="zone">La zona indicada arriba</option>
            </select>
          </div>
          <button type="submit" className={primary}>
            Convertir
          </button>
        </form>
        <p className={`mt-2 text-xs ${muted}`}>
          Si la fecha incluye Z o un desplazamiento (como -05:00), ese valor manda sobre la opción elegida.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">Ejemplos:</span>
          {DATE_EXAMPLES.map((ex) => (
            <button
              key={ex.label}
              type="button"
              className={button}
              onClick={() => {
                setDateInput(ex.value);
                convertDate(ex.value, mode);
              }}
            >
              {ex.label}
            </button>
          ))}
        </div>
        <Result outcome={dateOut} />
      </section>
    </div>
  );
}

function Result({ outcome }: { outcome: Outcome | null }) {
  return (
    <div role="status" aria-live="polite" className="mt-4">
      {outcome?.kind === 'error' && (
        <p role="alert" className={errorBox}>
          {outcome.message}
        </p>
      )}
      {outcome?.kind === 'ok' && (
        <>
          <ul>
            {outcome.rows.map((r) =>
              r.label === 'Interpretado como' || r.label === 'Interpretada en' ? (
                <li key={r.label} className="flex flex-wrap gap-2 py-1 text-sm">
                  <span className="w-44 shrink-0 font-medium">{r.label}</span>
                  <span>{r.value}</span>
                </li>
              ) : (
                <CopyRow key={r.label} label={r.label} value={r.value} />
              ),
            )}
          </ul>
          {outcome.note && <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">⚠ {outcome.note}</p>}
        </>
      )}
    </div>
  );
}
