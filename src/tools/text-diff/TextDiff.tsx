import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { area, button, errorBox, muted, primary } from '../../components/ui';
import { copyText } from '../../lib/clipboard';
import { byteLength, formatBytes } from '../../lib/validation';
import {
  DEFAULT_OPTIONS,
  DIFF_EXAMPLES,
  compareTexts,
  toPlainDiff,
  withContext,
  type DiffOptions,
  type DiffOutcome,
  type DiffRow,
  type Segment,
} from './text-diff';

/** Límite de filas dibujadas para no frenar el navegador; la copia siempre incluye todo. */
const MAX_RENDER_ROWS = 3000;

const rowStyles = {
  equal: '',
  added: 'bg-green-50 dark:bg-green-950/50',
  removed: 'bg-red-50 dark:bg-red-950/50',
  modified: '',
  skip: 'bg-slate-100 dark:bg-slate-900',
} as const;

function Highlighted({ segments, kind }: { segments: Segment[]; kind: 'added' | 'removed' }) {
  const mark = kind === 'added' ? 'bg-green-300 dark:bg-green-800' : 'bg-red-300 dark:bg-red-800';
  return (
    <>
      {segments.map((s, i) =>
        s.changed ? (
          <mark key={i} className={`${mark} rounded-sm text-inherit`}>
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}

function Line({ no1, no2, sign, label, cls, children }: { no1?: number; no2?: number; sign: string; label: string; cls: string; children: React.ReactNode }) {
  return (
    <tr className={cls}>
      <td className="w-10 select-none px-2 text-right align-top text-xs text-slate-600 dark:text-slate-400">{no1}</td>
      <td className="w-10 select-none px-2 text-right align-top text-xs text-slate-600 dark:text-slate-400">{no2}</td>
      <td className="w-6 select-none text-center align-top">
        <span aria-hidden="true">{sign}</span>
        <span className="sr-only">{label}</span>
      </td>
      <td className="whitespace-pre-wrap break-all pr-2 align-top">{children}</td>
    </tr>
  );
}

function DiffRows({ rows }: { rows: DiffRow[] }) {
  return (
    <>
      {rows.map((row, i) => {
        switch (row.type) {
          case 'equal':
            return (
              <Line key={i} no1={row.oldNo} no2={row.newNo} sign=" " label="Sin cambios" cls={rowStyles.equal}>
                {row.text || ' '}
              </Line>
            );
          case 'added':
            return (
              <Line key={i} no2={row.newNo} sign="+" label="Línea añadida" cls={rowStyles.added}>
                {row.text || ' '}
              </Line>
            );
          case 'removed':
            return (
              <Line key={i} no1={row.oldNo} sign="−" label="Línea eliminada" cls={rowStyles.removed}>
                {row.text || ' '}
              </Line>
            );
          case 'modified':
            return (
              <FragmentRows key={i}>
                <Line no1={row.oldNo} sign="−" label="Línea modificada, antes" cls={rowStyles.removed}>
                  <Highlighted segments={row.oldSegments} kind="removed" />
                </Line>
                <Line no2={row.newNo} sign="+" label="Línea modificada, después" cls={rowStyles.added}>
                  <Highlighted segments={row.newSegments} kind="added" />
                </Line>
              </FragmentRows>
            );
          case 'skip':
            return (
              <tr key={i} className={rowStyles.skip}>
                <td colSpan={4} className="px-2 py-1 text-center text-xs text-slate-600 dark:text-slate-400">
                  ⋯ {row.count} {row.count === 1 ? 'línea igual oculta' : 'líneas iguales ocultas'} ⋯
                </td>
              </tr>
            );
        }
      })}
    </>
  );
}

const FragmentRows = ({ children }: { children: React.ReactNode }) => <>{children}</>;

export default function TextDiff() {
  const ids = { left: useId(), right: useId() };
  const [left, setLeft] = useState('');
  const [right, setRight] = useState('');
  const [options, setOptions] = useState<DiffOptions>(DEFAULT_OPTIONS);
  const [onlyChanges, setOnlyChanges] = useState(false);
  const [outcome, setOutcome] = useState<DiffOutcome | null>(null);
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  function run(l = left, r = right, o = options) {
    setOutcome(compareTexts(l, r, o));
    setCopied(null);
  }

  function changeOption(patch: Partial<DiffOptions>) {
    const next = { ...options, ...patch };
    setOptions(next);
    if (outcome) run(left, right, next); // el resultado visible se actualiza al cambiar opciones
  }

  function swap() {
    setLeft(right);
    setRight(left);
    if (outcome) run(right, left);
  }

  function clearAll() {
    setLeft('');
    setRight('');
    setOutcome(null);
    setCopied(null);
  }

  const shown = useMemo(() => {
    if (!outcome?.ok) return null;
    const rows = onlyChanges ? withContext(outcome.rows, 2) : outcome.rows;
    return { rows: rows.slice(0, MAX_RENDER_ROWS), truncated: rows.length > MAX_RENDER_ROWS };
  }, [outcome, onlyChanges]);

  async function copyDiff() {
    if (!outcome?.ok) return;
    const ok = await copyText(toPlainDiff(outcome.rows));
    setCopied(ok ? 'ok' : 'fail');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(null), 2500);
  }

  const checkbox = 'size-4 rounded border-slate-300 accent-indigo-600';

  return (
    <div className="space-y-4">
      <fieldset className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <legend className="sr-only">Opciones de comparación</legend>
        <label className="flex items-center gap-2">
          <input type="checkbox" className={checkbox} checked={options.mode === 'json'} onChange={(e) => changeOption({ mode: e.target.checked ? 'json' : 'text' })} />
          Comparar como JSON
        </label>
        {options.mode === 'json' && (
          <label className="flex items-center gap-2">
            <input type="checkbox" className={checkbox} checked={options.sortKeys} onChange={(e) => changeOption({ sortKeys: e.target.checked })} />
            Ignorar el orden de las claves
          </label>
        )}
        <label className="flex items-center gap-2">
          <input type="checkbox" className={checkbox} checked={options.ignoreWhitespace} onChange={(e) => changeOption({ ignoreWhitespace: e.target.checked })} />
          Ignorar espacios en blanco
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" className={checkbox} checked={options.ignoreCase} onChange={(e) => changeOption({ ignoreCase: e.target.checked })} />
          Ignorar mayúsculas y minúsculas
        </label>
      </fieldset>

      <div className="grid gap-4 lg:grid-cols-2">
        {(
          [
            { id: ids.left, label: 'Texto original', value: left, set: setLeft },
            { id: ids.right, label: 'Texto modificado', value: right, set: setRight },
          ] as const
        ).map((f) => (
          <div key={f.id}>
            <label htmlFor={f.id} className="block text-sm font-medium">
              {f.label}
            </label>
            <textarea
              id={f.id}
              value={f.value}
              onChange={(e) => f.set(e.target.value)}
              spellCheck={false}
              autoComplete="off"
              className={`${area} mt-1 h-64`}
            />
            <p className={`mt-1 text-xs ${muted}`}>
              {f.value.length.toLocaleString('es')} caracteres · {formatBytes(byteLength(f.value))}
            </p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={primary} onClick={() => run()}>
          Comparar
        </button>
        <button type="button" className={button} onClick={swap} disabled={!left && !right}>
          Intercambiar
        </button>
        <button type="button" className={button} onClick={clearAll} disabled={!left && !right && !outcome}>
          Limpiar
        </button>
        <span className="ml-2 text-sm font-medium">Ejemplos:</span>
        {DIFF_EXAMPLES.map((ex) => (
          <button
            key={ex.label}
            type="button"
            className={button}
            onClick={() => {
              setLeft(ex.left);
              setRight(ex.right);
              const o = { ...options, mode: ex.mode };
              setOptions(o);
              run(ex.left, ex.right, o);
            }}
          >
            {ex.label}
          </button>
        ))}
      </div>

      <div role="status" aria-live="polite">
        {outcome && !outcome.ok && (
          <p role="alert" className={errorBox}>
            {outcome.error}
          </p>
        )}
        {outcome?.ok && outcome.identical && (
          <p className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-200">
            ✓ Los dos contenidos son iguales con las opciones elegidas.
          </p>
        )}
        {outcome?.ok && !outcome.identical && (
          <p className="text-sm">
            <strong>{outcome.stats.added}</strong> añadidas · <strong>{outcome.stats.removed}</strong> eliminadas · <strong>{outcome.stats.modified}</strong> modificadas · {outcome.stats.equal} sin cambios
          </p>
        )}
        {outcome?.ok && outcome.warning && <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">⚠ {outcome.warning}</p>}
      </div>

      {outcome?.ok && !outcome.identical && shown && (
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className={checkbox} checked={onlyChanges} onChange={(e) => setOnlyChanges(e.target.checked)} />
              Mostrar solo las diferencias
            </label>
            <button type="button" className={button} onClick={copyDiff}>
              Copiar diferencias
            </button>
            <span role="status" aria-live="polite" className="text-xs">
              {copied === 'ok' && <span className="text-green-700 dark:text-green-400">Copiado al portapapeles.</span>}
              {copied === 'fail' && <span className="text-red-700 dark:text-red-400">No se pudo copiar.</span>}
            </span>
          </div>
          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
            <table className="w-full border-collapse font-mono text-sm">
              <caption className="sr-only">Diferencias entre los dos textos</caption>
              <thead className="sr-only">
                <tr>
                  <th scope="col">Línea original</th>
                  <th scope="col">Línea nueva</th>
                  <th scope="col">Tipo</th>
                  <th scope="col">Contenido</th>
                </tr>
              </thead>
              <tbody>
                <DiffRows rows={shown.rows} />
              </tbody>
            </table>
          </div>
          {shown.truncated && (
            <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">
              ⚠ Se muestran las primeras {MAX_RENDER_ROWS.toLocaleString('es')} filas. «Copiar diferencias» incluye todas.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
