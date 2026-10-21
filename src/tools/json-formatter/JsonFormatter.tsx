import { useEffect, useId, useRef, useState } from 'react';
import { copyText } from '../../lib/clipboard';
import { downloadText } from '../../lib/download';
import { byteLength, formatBytes } from '../../lib/validation';
import { area, button, errorBox, field, muted, primary } from '../../components/ui';
import {
  JSON_EXAMPLES,
  formatJson,
  minifyJson,
  type IndentOption,
  type JsonError,
} from './json-formatter';

type Status =
  | { kind: 'idle' }
  | { kind: 'success'; text: string; warning?: string }
  | { kind: 'error'; error: JsonError };

const counter = (text: string) => `${text.length.toLocaleString('es')} caracteres · ${formatBytes(byteLength(text))}`;

export default function JsonFormatter() {
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [indent, setIndent] = useState<IndentOption>(2);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const ids = { input: useId(), output: useId(), indent: useId() };

  useEffect(() => () => window.clearTimeout(timer.current), []);

  function apply(result: ReturnType<typeof formatJson>, label: string) {
    if (result.ok) {
      setOutput(result.output);
      setStatus({ kind: 'success', text: label, warning: result.warning });
    } else {
      setOutput('');
      setStatus({ kind: 'error', error: result.error });
    }
    setCopied(null);
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

  function loadExample(value: string) {
    setInput(value);
    setOutput('');
    setStatus({ kind: 'idle' });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor={ids.indent} className="block text-sm font-medium">
            Indentación
          </label>
          <select
            id={ids.indent}
            value={String(indent)}
            onChange={(e) => {
              const v = e.target.value;
              setIndent(v === 'tab' ? 'tab' : (Number(v) as 2 | 4 | 8));
            }}
            className={`mt-1 ${field}`}
          >
            <option value="2">2 espacios</option>
            <option value="4">4 espacios</option>
            <option value="8">8 espacios</option>
            <option value="tab">Tabulador</option>
          </select>
        </div>
        <button type="button" className={primary} onClick={() => apply(formatJson(input, indent), 'JSON válido y formateado.')}>
          Formatear
        </button>
        <button type="button" className={button} onClick={() => apply(minifyJson(input), 'JSON válido y minificado.')}>
          Minificar
        </button>
        <button type="button" className={button} onClick={clear} disabled={!input && !output}>
          Limpiar
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">Ejemplos:</span>
        {JSON_EXAMPLES.map((ex) => (
          <button key={ex.label} type="button" className={button} onClick={() => loadExample(ex.value)}>
            {ex.label}
          </button>
        ))}
      </div>

      <div role="status" aria-live="polite" className="min-h-6 text-sm">
        {status.kind === 'success' && (
          <div>
            <p className="text-green-700 dark:text-green-400">✓ {status.text}</p>
            {status.warning && <p className="mt-1 text-amber-700 dark:text-amber-400">⚠ {status.warning}</p>}
          </div>
        )}
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
            Entrada
          </label>
          <textarea
            id={ids.input}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            placeholder='Pega aquí tu JSON, por ejemplo {"nombre":"Ana"}'
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
            <button type="button" className={button} onClick={() => downloadText('datos.json', output, 'application/json')} disabled={!output}>
              Descargar .json
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
