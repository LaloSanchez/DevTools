import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { area, button, errorBox, field, muted, primary } from '../../components/ui';
import { copyText } from '../../lib/clipboard';
import { downloadText } from '../../lib/download';
import { formatBytes } from '../../lib/validation';
import { formatJson } from '../json-formatter/json-formatter';
import PairsEditor, { toRows, type Row } from './PairsEditor';
import Tabs from './Tabs';
import TokenFetcher from './TokenFetcher';
import { sendRequest } from './http';
import {
  API_EXAMPLES,
  MAX_RESPONSE_BYTES,
  METHODS,
  TIMEOUT_MS,
  buildRequest,
  decodeBody,
  describeFetchError,
  emptySpec,
  isJsonType,
  isTextType,
  prettyBody,
  readLimited,
  statusText,
  toCurl,
  type AbortReason,
  type Auth,
  type BodyMode,
  type Method,
  type RequestSpec,
} from './api-tester';

type RequestTab = 'params' | 'headers' | 'body' | 'auth';
type ResponseTab = 'body' | 'headers';
type AuthKind = Auth['kind'];

interface ApiResponse {
  status: number;
  statusText: string;
  url: string;
  redirected: boolean;
  headers: [string, string][];
  contentType: string;
  size: number;
  truncated: boolean;
  /** null si la respuesta es binaria. */
  text: string | null;
  pretty: { output: string; warning?: string } | null;
  ms: number;
}

type Status = { kind: 'idle' } | { kind: 'loading' } | { kind: 'error'; message: string };

const BODY_MODES: { id: BodyMode; label: string }[] = [
  { id: 'none', label: 'Sin cuerpo' },
  { id: 'json', label: 'JSON' },
  { id: 'text', label: 'Texto' },
  { id: 'form', label: 'Formulario (x-www-form-urlencoded)' },
];

const activeCount = (rows: Row[]) => rows.filter((r) => r.enabled && r.key.trim()).length;
const withCount = (label: string, n: number) => (n ? `${label} (${n})` : label);

function statusColor(status: number): string {
  if (status < 300) return 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300';
  if (status < 400) return 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300';
  if (status < 500) return 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300';
  return 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300';
}

function useCopy() {
  const [state, setState] = useState<'ok' | 'fail' | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  async function copy(text: string) {
    setState((await copyText(text)) ? 'ok' : 'fail');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState(null), 2500);
  }
  return [state, copy] as const;
}

function CopyStatus({ state }: { state: 'ok' | 'fail' | null }) {
  return (
    <p role="status" aria-live="polite" className="mt-1 min-h-5 text-xs">
      {state === 'ok' && <span className="text-green-700 dark:text-green-400">Copiado al portapapeles.</span>}
      {state === 'fail' && <span className="text-red-700 dark:text-red-400">No se pudo copiar. Selecciona el texto y usa Ctrl+C.</span>}
    </p>
  );
}

export default function ApiTester() {
  const baseId = useId();
  const ids = { method: `${baseId}-method`, url: `${baseId}-url`, body: `${baseId}-body`, auth: `${baseId}-auth`, token: `${baseId}-token`, user: `${baseId}-user`, password: `${baseId}-password`, response: `${baseId}-response` };

  const [method, setMethod] = useState<Method>('GET');
  const [url, setUrl] = useState('');
  const [params, setParams] = useState<Row[]>([]);
  const [headers, setHeaders] = useState<Row[]>([]);
  const [bodyMode, setBodyMode] = useState<BodyMode>('none');
  const [body, setBody] = useState('');
  const [form, setForm] = useState<Row[]>([]);
  const [authKind, setAuthKind] = useState<AuthKind>('none');
  const [token, setToken] = useState('');
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');

  const [tab, setTab] = useState<RequestTab>('params');
  const [responseTab, setResponseTab] = useState<ResponseTab>('body');
  const [view, setView] = useState<'pretty' | 'raw'>('pretty');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [warnings, setWarnings] = useState<string[]>([]);
  const [response, setResponse] = useState<ApiResponse | null>(null);
  const [bodyCopied, copyBody] = useCopy();
  const [curlCopied, copyCurl] = useCopy();

  const controller = useRef<AbortController | null>(null);
  const abortReason = useRef<AbortReason | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  const spec = useMemo<RequestSpec>(() => {
    const auth: Auth =
      authKind === 'bearer' ? { kind: 'bearer', token } : authKind === 'basic' ? { kind: 'basic', user, password } : { kind: 'none' };
    return { method, url, params, headers, bodyMode, body, form, auth };
  }, [method, url, params, headers, bodyMode, body, form, authKind, token, user, password]);

  const built = useMemo(() => buildRequest(spec), [spec]);
  const curl = built.ok ? toCurl(built.request) : null;

  async function send() {
    const r = buildRequest(spec);
    if (!r.ok) {
      setWarnings([]);
      setStatus({ kind: 'error', message: r.error.message });
      return;
    }
    setWarnings(r.warnings);
    controller.current?.abort();
    const ctrl = new AbortController();
    controller.current = ctrl;
    abortReason.current = null;
    const timeout = window.setTimeout(() => {
      abortReason.current = 'timeout';
      ctrl.abort();
    }, TIMEOUT_MS);
    setStatus({ kind: 'loading' });
    const start = performance.now();
    try {
      const res = await sendRequest(r.request, ctrl.signal);
      const { bytes, truncated } = await readLimited(res, MAX_RESPONSE_BYTES);
      if (controller.current !== ctrl) return;
      const contentType = res.headers.get('content-type') ?? '';
      const text = isTextType(contentType) ? decodeBody(bytes, contentType) : null;
      const pretty = text && !truncated ? prettyBody(text, contentType) : null;
      setResponse({
        status: res.status,
        statusText: statusText(res.status, res.statusText),
        url: res.url,
        redirected: res.redirected,
        headers: [...res.headers.entries()],
        contentType,
        size: bytes.length,
        truncated,
        text,
        pretty,
        ms: performance.now() - start,
      });
      setView(pretty ? 'pretty' : 'raw');
      setStatus({ kind: 'idle' });
    } catch (e) {
      if (controller.current !== ctrl) return; // otra petición la sustituyó
      setResponse(null);
      setStatus({ kind: 'error', message: describeFetchError(e, abortReason.current) });
    } finally {
      window.clearTimeout(timeout);
      if (controller.current === ctrl) controller.current = null;
    }
  }

  function cancel() {
    abortReason.current = 'cancel';
    controller.current?.abort();
  }

  function load(example: RequestSpec) {
    // Se descarta la petición en curso sin mostrar «cancelada»: su resultado ya no corresponde a lo que hay en pantalla.
    const pending = controller.current;
    controller.current = null;
    pending?.abort();
    setMethod(example.method);
    setUrl(example.url);
    setParams(toRows(example.params));
    setHeaders(toRows(example.headers));
    setBodyMode(example.bodyMode);
    setBody(example.body);
    setForm(toRows(example.form));
    setAuthKind(example.auth.kind);
    setToken(example.auth.kind === 'bearer' ? example.auth.token : '');
    setUser(example.auth.kind === 'basic' ? example.auth.user : '');
    setPassword(example.auth.kind === 'basic' ? example.auth.password : '');
    setTab(example.bodyMode !== 'none' ? 'body' : 'params');
    setResponse(null);
    setWarnings([]);
    setStatus({ kind: 'idle' });
  }

  function formatBody() {
    const r = formatJson(body, 2);
    if (r.ok) setBody(r.output);
    else setStatus({ kind: 'error', message: `El cuerpo no es JSON válido: ${r.error.message}` });
  }

  const loading = status.kind === 'loading';
  const shownBody = response?.text == null ? '' : view === 'pretty' && response.pretty ? response.pretty.output : response.text;
  const extension = response && isJsonType(response.contentType) ? 'json' : 'txt';

  return (
    <div className="space-y-4">
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!loading) void send();
        }}
        className="flex flex-wrap items-end gap-2"
      >
        <div>
          <label htmlFor={ids.method} className="block text-sm font-medium">
            Método
          </label>
          <select id={ids.method} value={method} onChange={(e) => setMethod(e.target.value as Method)} className={`mt-1 font-mono ${field}`}>
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-0 flex-1 basis-64">
          <label htmlFor={ids.url} className="block text-sm font-medium">
            URL
          </label>
          <input
            id={ids.url}
            type="text"
            inputMode="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://api.ejemplo.com/usuarios"
            spellCheck={false}
            autoComplete="off"
            className={`mt-1 w-full font-mono ${field}`}
          />
        </div>
        {loading ? (
          <button type="button" className={button} onClick={cancel}>
            Cancelar
          </button>
        ) : (
          <button type="submit" className={primary}>
            Enviar
          </button>
        )}
        <button type="button" className={button} onClick={() => load(emptySpec())}>
          Limpiar
        </button>
      </form>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">Ejemplos:</span>
        {API_EXAMPLES.map((ex) => (
          <button key={ex.label} type="button" className={button} onClick={() => load(ex.spec)}>
            {ex.label}
          </button>
        ))}
      </div>

      <Tabs
        label="Partes de la petición"
        idBase={`${baseId}-req`}
        selected={tab}
        onSelect={setTab}
        tabs={[
          { id: 'params', label: withCount('Parámetros', activeCount(params)) },
          { id: 'headers', label: withCount('Cabeceras', activeCount(headers)) },
          { id: 'body', label: bodyMode === 'none' ? 'Cuerpo' : 'Cuerpo •' },
          { id: 'auth', label: authKind === 'none' ? 'Autenticación' : 'Autenticación •' },
        ]}
      >
        {tab === 'params' && (
          <PairsEditor
            rows={params}
            onChange={setParams}
            noun="parámetro"
            keyPlaceholder="nombre"
            valuePlaceholder="valor"
            empty="Se añaden a la URL como ?nombre=valor y se codifican automáticamente."
          />
        )}
        {tab === 'headers' && (
          <PairsEditor
            rows={headers}
            onChange={setHeaders}
            noun="cabecera"
            keyPlaceholder="Accept"
            valuePlaceholder="application/json"
            empty="Sin cabeceras propias. Content-Type se añade solo según el tipo de cuerpo."
          />
        )}
        {tab === 'body' && (
          <div className="space-y-3">
            <fieldset>
              <legend className="text-sm font-medium">Tipo de cuerpo</legend>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                {BODY_MODES.map((m) => (
                  <label key={m.id} className="flex items-center gap-1.5 text-sm">
                    <input type="radio" name={`${baseId}-mode`} checked={bodyMode === m.id} onChange={() => setBodyMode(m.id)} className="accent-indigo-600" />
                    {m.label}
                  </label>
                ))}
              </div>
            </fieldset>
            {bodyMode !== 'none' && (method === 'GET' || method === 'HEAD') && (
              <p className="text-sm text-amber-700 dark:text-amber-400">⚠ Las peticiones {method} no admiten cuerpo: cambia el método a POST, PUT o PATCH.</p>
            )}
            {(bodyMode === 'json' || bodyMode === 'text') && (
              <div>
                <label htmlFor={ids.body} className="sr-only">
                  Cuerpo de la petición
                </label>
                <textarea
                  id={ids.body}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder={bodyMode === 'json' ? '{"nombre": "Ana"}' : 'Texto que se enviará tal cual'}
                  className={`${area} h-48`}
                />
                {bodyMode === 'json' && (
                  <button type="button" className={`mt-1 ${button}`} onClick={formatBody} disabled={!body.trim()}>
                    Formatear JSON
                  </button>
                )}
              </div>
            )}
            {bodyMode === 'form' && (
              <PairsEditor rows={form} onChange={setForm} noun="campo" keyPlaceholder="campo" valuePlaceholder="valor" empty="Añade los campos del formulario." />
            )}
          </div>
        )}
        {tab === 'auth' && (
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor={ids.auth} className="block text-sm font-medium">
                Tipo
              </label>
              <select id={ids.auth} value={authKind} onChange={(e) => setAuthKind(e.target.value as AuthKind)} className={`mt-1 ${field}`}>
                <option value="none">Sin autenticación</option>
                <option value="bearer">Bearer token</option>
                <option value="basic">Basic (usuario y contraseña)</option>
              </select>
            </div>
            {authKind === 'bearer' && (
              <div className="min-w-0 flex-1 basis-64">
                <label htmlFor={ids.token} className="block text-sm font-medium">
                  Token
                </label>
                <input id={ids.token} type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" spellCheck={false} className={`mt-1 w-full font-mono ${field}`} />
              </div>
            )}
            {authKind === 'basic' && (
              <>
                <div>
                  <label htmlFor={ids.user} className="block text-sm font-medium">
                    Usuario
                  </label>
                  <input id={ids.user} type="text" value={user} onChange={(e) => setUser(e.target.value)} autoComplete="off" spellCheck={false} className={`mt-1 ${field}`} />
                </div>
                <div>
                  <label htmlFor={ids.password} className="block text-sm font-medium">
                    Contraseña
                  </label>
                  <input id={ids.password} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" className={`mt-1 ${field}`} />
                </div>
              </>
            )}
            <p className={`w-full text-xs ${muted}`}>Las credenciales no se guardan: desaparecen al recargar la página.</p>
            {authKind === 'bearer' && <TokenFetcher onToken={setToken} />}
          </div>
        )}
      </Tabs>

      <div role="status" aria-live="polite" className="min-h-6 text-sm">
        {loading && <p className={muted}>Enviando petición…</p>}
        {warnings.map((w) => (
          <p key={w} className="text-amber-700 dark:text-amber-400">
            ⚠ {w}
          </p>
        ))}
      </div>
      {status.kind === 'error' && (
        <div role="alert" className={errorBox}>
          <p>{status.message}</p>
        </div>
      )}

      {response && (
        <section aria-labelledby={ids.response} className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
          <div className="flex flex-wrap items-center gap-3">
            <h2 id={ids.response} className="font-semibold">
              Respuesta
            </h2>
            <span className={`rounded px-2 py-0.5 font-mono text-sm font-semibold ${statusColor(response.status)}`}>
              {response.status} {response.statusText}
            </span>
            <span className={`text-sm ${muted}`}>
              {Math.round(response.ms).toLocaleString('es')} ms · {formatBytes(response.size)}
            </span>
          </div>
          {response.redirected && <p className={`mt-2 break-all text-sm ${muted}`}>Se siguió una redirección hasta {response.url}</p>}

          <div className="mt-3">
            <Tabs
              label="Partes de la respuesta"
              idBase={`${baseId}-res`}
              selected={responseTab}
              onSelect={setResponseTab}
              tabs={[
                { id: 'body', label: 'Cuerpo' },
                { id: 'headers', label: withCount('Cabeceras', response.headers.length) },
              ]}
            >
              {responseTab === 'body' &&
                (response.text === null ? (
                  <p className={`text-sm ${muted}`}>
                    Respuesta binaria ({response.contentType || 'tipo desconocido'}, {formatBytes(response.size)}): no se muestra como texto.
                  </p>
                ) : response.size === 0 ? (
                  <p className={`text-sm ${muted}`}>La respuesta no tiene cuerpo.</p>
                ) : (
                  <div>
                    {response.truncated && (
                      <p className="mb-2 text-sm text-amber-700 dark:text-amber-400">⚠ La respuesta supera {formatBytes(MAX_RESPONSE_BYTES)}: solo se muestra el principio.</p>
                    )}
                    {response.pretty?.warning && <p className="mb-2 text-sm text-amber-700 dark:text-amber-400">⚠ {response.pretty.warning}</p>}
                    {response.pretty && (
                      <div className="mb-2 flex gap-2" role="group" aria-label="Vista del cuerpo">
                        <button type="button" className={button} aria-pressed={view === 'pretty'} onClick={() => setView('pretty')}>
                          Formateado
                        </button>
                        <button type="button" className={button} aria-pressed={view === 'raw'} onClick={() => setView('raw')}>
                          Original
                        </button>
                      </div>
                    )}
                    <textarea value={shownBody} readOnly spellCheck={false} aria-label="Cuerpo de la respuesta" className={area} />
                    <div className="mt-1 flex flex-wrap gap-2">
                      <button type="button" className={button} onClick={() => copyBody(shownBody)}>
                        Copiar
                      </button>
                      <button type="button" className={button} onClick={() => downloadText(`respuesta.${extension}`, shownBody, extension === 'json' ? 'application/json' : 'text/plain')}>
                        Descargar .{extension}
                      </button>
                    </div>
                    <CopyStatus state={bodyCopied} />
                  </div>
                ))}
              {responseTab === 'headers' && (
                <div>
                  <ul className="font-mono text-sm">
                    {response.headers.map(([k, v]) => (
                      <li key={k} className="flex flex-wrap gap-x-2 border-b border-slate-200 py-1.5 last:border-0 dark:border-slate-800">
                        <span className="font-semibold">{k}:</span>
                        <span className="min-w-0 break-all">{v}</span>
                      </li>
                    ))}
                  </ul>
                  <p className={`mt-2 text-xs ${muted}`}>Por seguridad (CORS), el navegador solo muestra las cabeceras que la API decide exponer.</p>
                </div>
              )}
            </Tabs>
          </div>
        </section>
      )}

      <details className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
        <summary className="cursor-pointer font-medium">Ver como comando cURL</summary>
        {curl ? (
          <div className="mt-3">
            <pre className="overflow-x-auto rounded-lg bg-slate-100 p-3 text-sm dark:bg-slate-900">
              <code>{curl}</code>
            </pre>
            <button type="button" className={`mt-2 ${button}`} onClick={() => copyCurl(curl)}>
              Copiar cURL
            </button>
            {authKind !== 'none' && <p className={`mt-1 text-xs ${muted}`}>El comando incluye tus credenciales: no lo compartas tal cual.</p>}
            <CopyStatus state={curlCopied} />
          </div>
        ) : (
          <p className={`mt-3 text-sm ${muted}`}>{built.ok ? '' : built.error.message}</p>
        )}
      </details>
    </div>
  );
}
