import { buildRequest, emptySpec, parseUrl, type ApiError, type BuildResult, type Method, type Pair } from './api-tester';

/** Formas de obtener un token que ofrece la herramienta. */
export type TokenFlow = 'login' | 'client_credentials' | 'password' | 'authorization_code';

/** Cómo se identifica el cliente OAuth ante el endpoint de token. */
export type ClientAuth = 'body' | 'basic';

export interface OAuthClient {
  tokenUrl: string;
  clientId: string;
  /** Opcional en clientes públicos (password o authorization code con PKCE). */
  clientSecret: string;
  scope: string;
  /** Lo exigen algunos proveedores, como Auth0. */
  audience: string;
  clientAuth: ClientAuth;
}

export type Grant =
  | { type: 'client_credentials' }
  | { type: 'password'; username: string; password: string }
  | { type: 'authorization_code'; code: string; redirectUri: string; codeVerifier: string }
  | { type: 'refresh_token'; refreshToken: string };

export interface TokenInfo {
  accessToken: string;
  tokenType?: string;
  expiresIn?: number;
  refreshToken?: string;
  scope?: string;
}

const fail = (message: string): { ok: false; error: ApiError } => ({ ok: false, error: { message } });
const pair = (key: string, value: string): Pair => ({ key, value, enabled: true });

/** Petición al endpoint de token (RFC 6749): formulario x-www-form-urlencoded y respuesta JSON. */
export function tokenRequest(client: OAuthClient, grant: Grant): BuildResult {
  if (!client.tokenUrl.trim()) return fail('Escribe la URL del endpoint de token.');
  if (!client.clientId.trim()) return fail('Escribe el client_id.');
  if (grant.type === 'client_credentials' && !client.clientSecret) return fail('El flujo client credentials necesita el client_secret.');
  if (grant.type === 'password' && !grant.username) return fail('Escribe el usuario.');

  const form = [pair('grant_type', grant.type)];
  if (grant.type === 'password') form.push(pair('username', grant.username), pair('password', grant.password));
  if (grant.type === 'authorization_code') {
    form.push(pair('code', grant.code), pair('redirect_uri', grant.redirectUri), pair('code_verifier', grant.codeVerifier));
  }
  if (grant.type === 'refresh_token') form.push(pair('refresh_token', grant.refreshToken));
  // Con authorization code y refresh token, el scope ya quedó fijado al autorizar.
  if (client.scope.trim() && (grant.type === 'client_credentials' || grant.type === 'password')) form.push(pair('scope', client.scope.trim()));
  if (client.audience.trim() && grant.type !== 'refresh_token') form.push(pair('audience', client.audience.trim()));

  const basic = client.clientAuth === 'basic' && client.clientSecret !== '';
  if (!basic) {
    form.push(pair('client_id', client.clientId.trim()));
    if (client.clientSecret) form.push(pair('client_secret', client.clientSecret));
  }

  return buildRequest({
    ...emptySpec(),
    method: 'POST',
    url: client.tokenUrl,
    // Sin Accept, algunos proveedores (como GitHub) responden en formato formulario en vez de JSON.
    headers: [pair('Accept', 'application/json')],
    bodyMode: 'form',
    form,
    auth: basic ? { kind: 'basic', user: client.clientId.trim(), password: client.clientSecret } : { kind: 'none' },
  });
}

/** Petición de login propia: el token sale de su respuesta JSON. */
export function loginRequest(method: Method, url: string, body: string): BuildResult {
  return buildRequest({
    ...emptySpec(),
    method,
    url,
    headers: [pair('Accept', 'application/json')],
    bodyMode: body.trim() ? 'json' : 'none',
    body,
  });
}

/** Lee la respuesta del endpoint de token, en JSON o, si el proveedor la manda así, en formato formulario. */
export function parseTokenResponse(status: number, text: string): { ok: true; token: TokenInfo } | { ok: false; error: ApiError } {
  let data: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error();
    data = parsed as Record<string, unknown>;
  } catch {
    data = Object.fromEntries(new URLSearchParams(text));
  }
  if (typeof data.error === 'string') {
    const detail = typeof data.error_description === 'string' ? `: ${data.error_description}` : '';
    return fail(`El proveedor rechazó la petición (${data.error}${detail}).`);
  }
  if (status >= 400) return fail(`El endpoint de token respondió con el código ${status}.`);
  const accessToken = data.access_token;
  if (typeof accessToken !== 'string' || !accessToken) return fail('La respuesta no incluye access_token.');
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  const expires = Number(data.expires_in);
  return {
    ok: true,
    token: {
      accessToken,
      tokenType: str(data.token_type),
      expiresIn: Number.isFinite(expires) && expires > 0 ? expires : undefined,
      refreshToken: str(data.refresh_token),
      scope: str(data.scope),
    },
  };
}

/** Valor en una ruta como «data.token» o «items[0].jwt». */
export function getPath(value: unknown, path: string): unknown {
  const keys = path.trim().replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let current = value;
  for (const key of keys) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

const TOKEN_PATHS = ['access_token', 'accessToken', 'token', 'id_token', 'jwt', 'data.access_token', 'data.accessToken', 'data.token', 'result.token'];

/** Busca el token en la respuesta de un login: en la ruta indicada o, si se deja vacía, en los nombres habituales. */
export function findToken(text: string, path: string): { ok: true; token: string; path: string } | { ok: false; error: ApiError } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return fail('La respuesta del login no es JSON, así que no se puede leer el token.');
  }
  const paths = path.trim() ? [path.trim()] : TOKEN_PATHS;
  for (const p of paths) {
    const v = getPath(data, p);
    if (typeof v === 'string' && v.trim()) return { ok: true, token: v.trim(), path: p };
  }
  return fail(
    path.trim()
      ? `No hay un texto en «${path.trim()}» de la respuesta. Revisa la ruta del campo.`
      : `No se encontró el token en los campos habituales (${TOKEN_PATHS.join(', ')}). Indica la ruta del campo.`,
  );
}

const base64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Texto aleatorio seguro en base64url, para el code_verifier y el state. */
export function randomString(bytes = 32): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** code_challenge S256 de PKCE (RFC 7636). */
export async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

export interface AuthorizeOptions {
  authUrl: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  audience: string;
  state: string;
  challenge: string;
  /** Pide el código en el fragmento (#), que no llega al servidor que aloja la página de retorno. */
  fragment: boolean;
}

/** URL de autorización a la que se envía al usuario en la ventana emergente. */
export function authorizeUrl(o: AuthorizeOptions): { ok: true; url: string } | { ok: false; error: ApiError } {
  if (!o.authUrl.trim()) return fail('Escribe la URL de autorización.');
  if (!o.clientId.trim()) return fail('Escribe el client_id.');
  const parsed = parseUrl(o.authUrl);
  if (!parsed.ok) return parsed;
  const { url } = parsed;
  const params: [string, string][] = [
    ['response_type', 'code'],
    ['client_id', o.clientId.trim()],
    ['redirect_uri', o.redirectUri],
    ['state', o.state],
    ['code_challenge', o.challenge],
    ['code_challenge_method', 'S256'],
  ];
  if (o.scope.trim()) params.push(['scope', o.scope.trim()]);
  if (o.audience.trim()) params.push(['audience', o.audience.trim()]);
  if (o.fragment) params.push(['response_mode', 'fragment']);
  for (const [k, v] of params) url.searchParams.set(k, v);
  return { ok: true, url: url.href };
}

/** Comprueba lo que devolvió el proveedor en la URL de retorno y extrae el código. */
export function parseCallback(params: Record<string, string>, expectedState: string): { ok: true; code: string } | { ok: false; error: ApiError } {
  if (params.error) {
    return fail(`El proveedor no autorizó el acceso (${params.error}${params.error_description ? `: ${params.error_description}` : ''}).`);
  }
  if (params.state !== expectedState) return fail('El parámetro state no coincide: se descartó la respuesta por seguridad. Vuelve a intentarlo.');
  if (!params.code) return fail('El proveedor no devolvió ningún código de autorización.');
  return { ok: true, code: params.code };
}

/** Datos públicos de un JWT (no se verifica la firma: solo se muestran). Devuelve null si no es un JWT. */
export function decodeJwt(token: string): { exp?: number; sub?: string; iss?: string } | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '='));
    const json: unknown = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0))));
    if (typeof json !== 'object' || json === null) return null;
    const { exp, sub, iss } = json as Record<string, unknown>;
    return {
      exp: typeof exp === 'number' ? exp : undefined,
      sub: typeof sub === 'string' ? sub : undefined,
      iss: typeof iss === 'string' ? iss : undefined,
    };
  } catch {
    return null;
  }
}

/** Ruta de la página de retorno de OAuth; hay que registrarla en el proveedor. */
export const CALLBACK_PATH = '/tools/api-tester/callback/';
/** Canal por el que la página de retorno entrega el código a la pestaña del probador. */
export const CALLBACK_CHANNEL = 'devtools-oauth-callback';
