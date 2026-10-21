import { useEffect, useId, useRef, useState } from 'react';
import { area, button, errorBox, field, muted, primary } from '../../components/ui';
import { copyText } from '../../lib/clipboard';
import { downloadText } from '../../lib/download';
import { byteLength, formatBytes } from '../../lib/validation';
import { SQL_EXAMPLES } from './sql-examples';
// Solo tipos y constantes ligeras: la biblioteca de formato se descarga al pulsar «Formatear».
import type { Dialect, KeywordCase, SqlError, SqlIndent, SqlOptions } from './sql-formatter';

type Status = { kind: 'idle' } | { kind: 'loading' } | { kind: 'success' } | { kind: 'error'; error: SqlError };

const counter = (text: string) => `${text.length.toLocaleString('es')} caracteres · ${formatBytes(byteLength(text))}`;

export default function SqlFormatter() {
  const ids = { input: useId(), output: useId(), dialect: useId(), indent: useId(), kw: useId() };
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [options, setOptions] = useState<SqlOptions>({ dialect: 'mysql', indent: 2, keywordCase: 'preserve' });
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function run(sql = input, opts = options) {
    setStatus({ kind: 'loading' });
    setCopied(null);
    try {
      const { formatSql } = await import('./sql-formatter');
      const result = formatSql(sql, opts);
      if (result.ok) {
        setOutput(result.output);
        setStatus({ kind: 'success' });
      } else {
        setOutput('');
        setStatus({ kind: 'error', error: result.error });
      }
    } catch {
      setOutput('');
      setStatus({ kind: 'error', error: { message: 'No se pudo cargar el formateador. Revisa tu conexión e inténtalo de nuevo.' } });
    }
  }

  function change(patch: Partial<SqlOptions>) {
    const next = { ...options, ...patch };
    setOptions(next);
    if (output) void run(input, next); // si ya hay un resultado, se actualiza con la nueva opción
  }

  async function handleCopy() {
    const ok = await copyText(output);
    setCopied(ok ? 'ok' : 'fail');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(null), 2500);
  }

  function clear() {
    setInput('');
    setOutput('');
    setStatus({ kind: 'idle' });
    setCopied(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor={ids.dialect} className="block text-sm font-medium">
            Dialecto
          </label>
          <select id={ids.dialect} value={options.dialect} onChange={(e) => change({ dialect: e.target.value as Dialect })} className={`mt-1 ${field}`}>
            <option value="mysql">MySQL</option>
            <option value="transactsql">Transact-SQL (SQL Server)</option>
          </select>
        </div>
        <div>
          <label htmlFor={ids.indent} className="block text-sm font-medium">
            Indentación
          </label>
          <select
            id={ids.indent}
            value={String(options.indent)}
            onChange={(e) => change({ indent: (e.target.value === 'tab' ? 'tab' : Number(e.target.value)) as SqlIndent })}
            className={`mt-1 ${field}`}
          >
            <option value="2">2 espacios</option>
            <option value="4">4 espacios</option>
            <option value="tab">Tabulador</option>
          </select>
        </div>
        <div>
          <label htmlFor={ids.kw} className="block text-sm font-medium">
            Palabras clave
          </label>
          <select id={ids.kw} value={options.keywordCase} onChange={(e) => change({ keywordCase: e.target.value as KeywordCase })} className={`mt-1 ${field}`}>
            <option value="preserve">Como están</option>
            <option value="upper">MAYÚSCULAS</option>
            <option value="lower">minúsculas</option>
          </select>
        </div>
        <button type="button" className={primary} onClick={() => void run()} disabled={status.kind === 'loading'}>
          {status.kind === 'loading' ? 'Formateando…' : 'Formatear'}
        </button>
        <button type="button" className={button} onClick={clear} disabled={!input && !output}>
          Limpiar
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">Ejemplos:</span>
        {SQL_EXAMPLES.map((ex) => (
          <button
            key={ex.label}
            type="button"
            className={button}
            onClick={() => {
              const next = { ...options, dialect: ex.dialect };
              setOptions(next);
              setInput(ex.sql);
              setOutput('');
              setStatus({ kind: 'idle' });
            }}
          >
            {ex.label}
          </button>
        ))}
      </div>

      <div role="status" aria-live="polite" className="min-h-6 text-sm">
        {status.kind === 'success' && <p className="text-green-700 dark:text-green-400">✓ Consulta formateada.</p>}
      </div>
      {status.kind === 'error' && (
        <div role="alert" className={errorBox}>
          <p className="font-medium">{status.error.message}</p>
          {status.error.line !== undefined && (
            <p className="mt-1">
              Cerca de la línea {status.error.line}, columna {status.error.column}.
            </p>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <label htmlFor={ids.input} className="block text-sm font-medium">
            Consulta SQL
          </label>
          <textarea
            id={ids.input}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            placeholder="Pega aquí tu consulta, por ejemplo: select * from usuarios where activo = 1"
            aria-invalid={status.kind === 'error'}
            className={`${area} mt-1`}
          />
          <p className={`mt-1 text-xs ${muted}`}>{counter(input)}</p>
        </div>
        <div>
          <label htmlFor={ids.output} className="block text-sm font-medium">
            Resultado
          </label>
          <textarea id={ids.output} value={output} readOnly spellCheck={false} className={`${area} mt-1`} />
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <p className={`mr-auto text-xs ${muted}`}>{counter(output)}</p>
            <button type="button" className={button} onClick={handleCopy} disabled={!output}>
              Copiar
            </button>
            <button type="button" className={button} onClick={() => downloadText('consulta.sql', output, 'application/sql')} disabled={!output}>
              Descargar .sql
            </button>
          </div>
          <p role="status" aria-live="polite" className="mt-1 min-h-5 text-xs">
            {copied === 'ok' && <span className="text-green-700 dark:text-green-400">Copiado al portapapeles.</span>}
            {copied === 'fail' && <span className="text-red-700 dark:text-red-400">No se pudo copiar. Selecciona el texto y usa Ctrl+C.</span>}
          </p>
        </div>
      </div>
    </div>
  );
}
