import { formatJson } from '../json-formatter/json-formatter';
import { MAX_INPUT_BYTES, byteLength, formatBytes } from '../../lib/validation';

export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
export type Method = (typeof METHODS)[number];

export type BodyMode = 'none' | 'json' | 'text' | 'form';

export type Auth =
  | { kind: 'none' }
  | { kind: 'bearer'; token: string }
  | { kind: 'basic'; user: string; password: string };

/** Fila clave-valor de parámetros, cabeceras o formulario. */
export interface Pair {
  key: string;
  value: string;
  enabled: boolean;
}

export interface RequestSpec {
  method: Method;
  url: string;
  params: Pair[];
  headers: Pair[];
  bodyMode: BodyMode;
  /** Cuerpo en los modos JSON y texto. */
  body: string;
  /** Campos en el modo formulario. */
  form: Pair[];
  auth: Auth;
}

/** Petición lista para pasar a fetch y para mostrar como cURL. */
export interface BuiltRequest {
  method: Method;
  url: string;
  headers: [string, string][];
  body?: string;
}

export interface ApiError {
  message: string;
}

export type BuildResult = { ok: true; request: BuiltRequest; warnings: string[] } | { ok: false; error: ApiError };

/** Límite del cuerpo que se envía. */
export const MAX_BODY_BYTES = 1024 * 1024;
/** Límite de la respuesta que se lee y se muestra; el resto se descarta. */
export const MAX_RESPONSE_BYTES = MAX_INPUT_BYTES;
export const TIMEOUT_MS = 30_000;

// Cabeceras que el navegador no deja fijar desde JavaScript (especificación Fetch).
const FORBIDDEN_HEADERS = new Set([
  'accept-charset',
  'accept-encoding',
  'access-control-request-headers',
  'access-control-request-method',
  'connection',
  'content-length',
  'cookie',
  'cookie2',
  'date',
  'dnt',
  'expect',
  'host',
  'keep-alive',
  'origin',
  'referer',
  'set-cookie',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'via',
]);
const FORBIDDEN_PREFIXES = ['proxy-', 'sec-'];

const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const LOCAL_HOST = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])$|\.localhost$/i;

const fail = (message: string): BuildResult => ({ ok: false, error: { message } });
const activePairs = (pairs: Pair[]) => pairs.filter((p) => p.enabled && p.key.trim() !== '');
const hasHeader = (headers: [string, string][], name: string) =>
  headers.some(([k]) => k.toLowerCase() === name.toLowerCase());

export const isLocalHost = (hostname: string): boolean => LOCAL_HOST.test(hostname);

/** Valida la URL y le añade el esquema si falta (http:// para localhost, https:// para el resto). */
export function parseUrl(input: string): { ok: true; url: URL; added: boolean } | { ok: false; error: ApiError } {
  const raw = input.trim();
  if (!raw) return { ok: false, error: { message: 'Escribe la URL de la API.' } };
  const hasScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(raw);
  let candidate = raw;
  if (!hasScheme) {
    const host = raw.split(/[/:?#]/, 1)[0];
    candidate = `${isLocalHost(host) ? 'http' : 'https'}://${raw}`;
  }
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, error: { message: 'La URL no es válida. Ejemplo: https://api.ejemplo.com/usuarios' } };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: { message: 'Solo se admiten URLs http:// o https://.' } };
  }
  if (url.username || url.password) {
    return {
      ok: false,
      error: { message: 'El navegador no permite usuario y contraseña dentro de la URL. Quítalos y usa la pestaña «Autenticación» (Basic).' },
    };
  }
  url.hash = ''; // el fragmento nunca se envía al servidor
  return { ok: true, url, added: !hasScheme };
}

function utf8ToBase64(text: string): string {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Convierte lo que el usuario rellenó en una petición válida para fetch, o explica qué falla. */
export function buildRequest(spec: RequestSpec): BuildResult {
  const parsed = parseUrl(spec.url);
  if (!parsed.ok) return parsed;
  const { url } = parsed;
  const warnings: string[] = [];
  if (parsed.added) warnings.push(`Se añadió ${url.protocol}// al principio de la URL.`);
  if (url.protocol === 'http:' && !isLocalHost(url.hostname)) {
    warnings.push('Desde una página https:// el navegador bloquea las peticiones a http:// salvo a localhost. Usa https:// si la API lo admite.');
  }

  for (const p of activePairs(spec.params)) url.searchParams.append(p.key.trim(), p.value);

  const headers: [string, string][] = [];
  for (const p of activePairs(spec.headers)) {
    const name = p.key.trim();
    if (!HEADER_NAME.test(name)) return fail(`El nombre de cabecera «${name}» no es válido: no puede tener espacios, tildes ni símbolos como : o ().`);
    if (/[\r\n\0]/.test(p.value)) return fail(`El valor de la cabecera «${name}» no puede tener saltos de línea.`);
    if ([...p.value].some((ch) => ch.codePointAt(0)! > 0xff)) return fail(`El valor de la cabecera «${name}» tiene caracteres que HTTP no admite (emojis, letras fuera del alfabeto latino…).`);
    const lower = name.toLowerCase();
    if (FORBIDDEN_HEADERS.has(lower) || FORBIDDEN_PREFIXES.some((pre) => lower.startsWith(pre))) {
      warnings.push(`El navegador no permite fijar la cabecera «${name}»: se ignorará.`);
      continue;
    }
    headers.push([name, p.value]);
  }

  const { auth } = spec;
  if (auth.kind !== 'none') {
    if (hasHeader(headers, 'authorization')) {
      warnings.push('Ya hay una cabecera Authorization en la tabla: se usa esa y se ignora la pestaña «Autenticación».');
    } else if (auth.kind === 'bearer') {
      const token = auth.token.trim();
      if (!token) return fail('Escribe el token Bearer o elige «Sin autenticación».');
      if (/[^\x21-\x7e]/.test(token)) return fail('El token Bearer no puede tener espacios ni caracteres especiales.');
      headers.push(['Authorization', `Bearer ${token}`]);
    } else {
      if (!auth.user) return fail('Escribe el usuario de la autenticación Basic.');
      headers.push(['Authorization', `Basic ${utf8ToBase64(`${auth.user}:${auth.password}`)}`]);
    }
  }

  let body: string | undefined;
  let contentType: string | undefined;
  if (spec.bodyMode === 'json') {
    if (!spec.body.trim()) return fail('Escribe el cuerpo JSON o elige «Sin cuerpo».');
    try {
      JSON.parse(spec.body);
    } catch (e) {
      return fail(`El cuerpo no es JSON válido: ${e instanceof Error ? e.message : String(e)}`);
    }
    body = spec.body;
    contentType = 'application/json';
  } else if (spec.bodyMode === 'text') {
    if (spec.body !== '') {
      body = spec.body;
      contentType = 'text/plain;charset=UTF-8';
    }
  } else if (spec.bodyMode === 'form') {
    const form = new URLSearchParams();
    for (const p of activePairs(spec.form)) form.append(p.key.trim(), p.value);
    body = form.toString();
    contentType = 'application/x-www-form-urlencoded;charset=UTF-8';
  }

  if (body !== undefined) {
    if (spec.method === 'GET' || spec.method === 'HEAD') {
      return fail(`Las peticiones ${spec.method} no pueden llevar cuerpo. Cambia el método o elige «Sin cuerpo».`);
    }
    if (byteLength(body) > MAX_BODY_BYTES) {
      return fail(`El cuerpo ocupa ${formatBytes(byteLength(body))}; el máximo es ${formatBytes(MAX_BODY_BYTES)}.`);
    }
    if (contentType && !hasHeader(headers, 'content-type')) headers.push(['Content-Type', contentType]);
  }

  return { ok: true, request: { method: spec.method, url: url.href, headers, body }, warnings };
}

const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** Comando cURL equivalente, para repetir la petición desde la terminal. */
export function toCurl(req: BuiltRequest): string {
  const method = req.method === 'HEAD' ? ' --head' : req.method === 'GET' ? '' : ` -X ${req.method}`;
  const parts = [`curl${method} ${shellQuote(req.url)}`];
  for (const [k, v] of req.headers) parts.push(`-H ${shellQuote(`${k}: ${v}`)}`);
  if (req.body !== undefined) parts.push(`--data-raw ${shellQuote(req.body)}`);
  return parts.join(' \\\n  ');
}

/** Lee el cuerpo de la respuesta hasta `max` bytes, para no bloquear la pestaña con descargas enormes. */
export async function readLimited(res: Response, max: number): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (!res.body) return { bytes: new Uint8Array(0), truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.length > max) {
      chunks.push(value.subarray(0, max - size));
      size = max;
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
    size += value.length;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  return { bytes, truncated };
}

const mediaType = (contentType: string) => contentType.split(';', 1)[0].trim().toLowerCase();

export const isJsonType = (contentType: string): boolean => /^application\/(.+\+)?json$/.test(mediaType(contentType));

/** true si la respuesta se puede mostrar como texto. Sin Content-Type, se intenta como texto. */
export function isTextType(contentType: string): boolean {
  const type = mediaType(contentType);
  if (!type) return true;
  return (
    type.startsWith('text/') ||
    isJsonType(type) ||
    type === 'application/xml' ||
    type.endsWith('+xml') ||
    ['application/javascript', 'application/x-www-form-urlencoded', 'application/graphql', 'application/yaml', 'application/x-yaml'].includes(type)
  );
}

/** Decodifica el cuerpo con el charset de Content-Type, o UTF-8 si no se indica o no se reconoce. */
export function decodeBody(bytes: Uint8Array, contentType: string): string {
  const charset = /charset="?([^";]+)"?/i.exec(contentType)?.[1];
  try {
    return new TextDecoder(charset ?? 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/** Formatea el cuerpo si es JSON (por Content-Type o por su aspecto). Si no lo es, devuelve null. */
export function prettyBody(text: string, contentType: string): { output: string; warning?: string } | null {
  const looksJson = /^\s*[[{]/.test(text);
  if (!isJsonType(contentType) && !looksJson) return null;
  const r = formatJson(text, 2);
  return r.ok ? { output: r.output, warning: r.warning } : null;
}

const STATUS_TEXT: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  204: 'No Content',
  301: 'Moved Permanently',
  302: 'Found',
  304: 'Not Modified',
  307: 'Temporary Redirect',
  308: 'Permanent Redirect',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Content',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

/** Texto del código de estado. Con HTTP/2 el servidor no lo envía, así que se completa con el nombre estándar. */
export const statusText = (status: number, fromServer = ''): string => fromServer || STATUS_TEXT[status] || '';

export type AbortReason = 'timeout' | 'cancel';

/** Explica por qué falló fetch. El navegador no detalla la causa, así que se listan las habituales. */
export function describeFetchError(error: unknown, reason: AbortReason | null): string {
  if (reason === 'cancel') return 'Petición cancelada.';
  if (reason === 'timeout') return `La API no respondió en ${TIMEOUT_MS / 1000} segundos.`;
  const detail = error instanceof Error && error.message ? ` (${error.message})` : '';
  return (
    `No se pudo completar la petición${detail}. Causas habituales: la API no permite peticiones desde otros sitios (CORS), ` +
    'la dirección no existe o no responde, el certificado HTTPS no es válido o el navegador bloqueó una petición http:// desde una página https://. ' +
    'La consola del navegador (F12) suele indicar el motivo exacto.'
  );
}

export interface RequestExample {
  label: string;
  spec: RequestSpec;
}

const emptyPairs = (): Pair[] => [];

export const emptySpec = (): RequestSpec => ({
  method: 'GET',
  url: '',
  params: emptyPairs(),
  headers: emptyPairs(),
  bodyMode: 'none',
  body: '',
  form: emptyPairs(),
  auth: { kind: 'none' },
});

// APIs públicas de prueba que permiten CORS.
export const API_EXAMPLES: RequestExample[] = [
  {
    label: 'GET con JSON',
    spec: { ...emptySpec(), url: 'https://jsonplaceholder.typicode.com/todos/1' },
  },
  {
    label: 'GET con parámetros',
    spec: {
      ...emptySpec(),
      url: 'https://jsonplaceholder.typicode.com/comments',
      params: [{ key: 'postId', value: '1', enabled: true }],
    },
  },
  {
    label: 'POST con JSON',
    spec: {
      ...emptySpec(),
      method: 'POST',
      url: 'https://jsonplaceholder.typicode.com/posts',
      bodyMode: 'json',
      body: '{\n  "title": "Hola",\n  "body": "Prueba desde DevTools",\n  "userId": 1\n}',
    },
  },
];
