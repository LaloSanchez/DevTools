import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react';
import { area, button, errorBox, field, muted, primary } from '../../components/ui';
import Tooltip from '../../components/Tooltip';
import { copyText } from '../../lib/clipboard';
import { MAX_RESPONSE_BYTES, TIMEOUT_MS, decodeBody, describeFetchError, readLimited, type BuildResult, type Method } from './api-tester';
import { sendRequest } from './http';
import {
  CALLBACK_CHANNEL,
  CALLBACK_PATH,
  authorizeUrl,
  codeChallenge,
  decodeJwt,
  findToken,
  loginRequest,
  parseCallback,
  parseTokenResponse,
  randomString,
  tokenRequest,
  type ClientAuth,
  type Grant,
  type OAuthClient,
  type TokenFlow,
  type TokenInfo,
} from './token';

const FLOWS: { id: TokenFlow; label: string; help: string }[] = [
  {
    id: 'login',
    label: 'Petición de login (token en la respuesta)',
    help: 'Para APIs propias: envía tus credenciales a un endpoint de login y toma el token de su respuesta JSON.',
  },
  {
    id: 'client_credentials',
    label: 'OAuth 2.0 · Client credentials',
    help: 'Para comunicación entre servicios: el token se pide con el client_id y el client_secret de la aplicación.',
  },
  {
    id: 'password',
    label: 'OAuth 2.0 · Usuario y contraseña (password)',
    help: 'El token se pide con el usuario y la contraseña. Lo admiten Keycloak y algunos proveedores; OAuth 2.1 lo desaconseja.',
  },
  {
    id: 'authorization_code',
    label: 'OAuth 2.0 · Authorization code + PKCE',
    help: 'Inicias sesión en el proveedor en una ventana emergente y DevTools canjea el código por el token. Es el flujo recomendado para usuarios reales.',
  },
];

type Status = { kind: 'idle' } | { kind: 'loading'; message: string } | { kind: 'error'; message: string };

interface Result {
  token: string;
  info?: TokenInfo;
  source: string;
}

interface FieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'password';
  placeholder?: string;
  /** Ayuda que se muestra en un tooltip junto a la etiqueta. */
  hint?: string;
  wide?: boolean;
}

function TextField({ label, value, onChange, type = 'text', placeholder, hint, wide }: FieldProps) {
  const id = useId();
  return (
    <div className={wide ? 'min-w-0 flex-1 basis-full' : 'min-w-0 flex-1 basis-56'}>
      <div className="flex items-center">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {hint && <Tooltip text={hint} />}
      </div>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        className={`mt-1 w-full font-mono ${field}`}
      />
    </div>
  );
}

function expiryText(result: Result): string | null {
  const exp = decodeJwt(result.token)?.exp;
  if (exp) return `caduca el ${new Date(exp * 1000).toLocaleString('es')}`;
  if (result.info?.expiresIn) return `caduca en ${Math.round(result.info.expiresIn / 60).toLocaleString('es')} min`;
  return null;
}

interface Props {
  /** Recibe el token obtenido para usarlo como Bearer. */
  onToken: (token: string) => void;
}

/** Obtiene un token de acceso por login propio o por OAuth 2.0 y lo entrega al probador. */
export default function TokenFetcher({ onToken }: Props) {
  const ids = { flow: useId(), method: useId(), body: useId(), clientAuth: useId(), redirect: useId(), fragment: useId() };
  const [flow, setFlow] = useState<TokenFlow>('login');

  const [loginMethod, setLoginMethod] = useState<Method>('POST');
  const [loginUrl, setLoginUrl] = useState('');
  const [loginBody, setLoginBody] = useState('{\n  "email": "",\n  "password": ""\n}');
  const [tokenPath, setTokenPath] = useState('');

  const [tokenUrl, setTokenUrl] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [scope, setScope] = useState('');
  const [audience, setAudience] = useState('');
  const [clientAuth, setClientAuth] = useState<ClientAuth>('body');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [authUrl, setAuthUrl] = useState('');
  const [fragment, setFragment] = useState(false);
  const [redirectUri, setRedirectUri] = useState('');

  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [result, setResult] = useState<Result | null>(null);
  const [copied, setCopied] = useState(false);

  /** Datos del inicio de sesión en curso: se comparan con lo que devuelve la página de retorno. */
  const pending = useRef<{ state: string; verifier: string; client: OAuthClient; redirectUri: string } | null>(null);
  const onCallback = useRef<(params: Record<string, string>) => void>(() => {});

  // La URL de retorno depende del dominio en que se abre la página, así que se calcula en el navegador.
  useEffect(() => setRedirectUri(new URL(CALLBACK_PATH, location.origin).href), []);

  useEffect(() => {
    const channel = new BroadcastChannel(CALLBACK_CHANNEL);
    channel.onmessage = (e: MessageEvent) => {
      if (typeof e.data === 'object' && e.data !== null) onCallback.current(e.data as Record<string, string>);
    };
    return () => channel.close();
  }, []);

  const client = (): OAuthClient => ({ tokenUrl, clientId, clientSecret, scope, audience, clientAuth });

  async function run(r: BuildResult, message: string): Promise<{ status: number; text: string } | null> {
    setResult(null); // que no quede a la vista el token de un intento anterior
    if (!r.ok) {
      setStatus({ kind: 'error', message: r.error.message });
      return null;
    }
    setStatus({ kind: 'loading', message });
    try {
      const res = await sendRequest(r.request, AbortSignal.timeout(TIMEOUT_MS));
      const { bytes } = await readLimited(res, MAX_RESPONSE_BYTES);
      return { status: res.status, text: decodeBody(bytes, res.headers.get('content-type') ?? '') };
    } catch (e) {
      const timeout = e instanceof DOMException && e.name === 'TimeoutError';
      setStatus({ kind: 'error', message: describeFetchError(e, timeout ? 'timeout' : null) });
      return null;
    }
  }

  function deliver(next: Result) {
    setResult(next);
    setCopied(false);
    onToken(next.token);
    setStatus({ kind: 'idle' });
  }

  async function oauth(c: OAuthClient, grant: Grant, source: string) {
    const res = await run(tokenRequest(c, grant), 'Pidiendo el token…');
    if (!res) return;
    const parsed = parseTokenResponse(res.status, res.text);
    if (!parsed.ok) setStatus({ kind: 'error', message: parsed.error.message });
    else deliver({ token: parsed.token.accessToken, info: parsed.token, source });
  }

  async function login() {
    const res = await run(loginRequest(loginMethod, loginUrl, loginBody), 'Enviando el login…');
    if (!res) return;
    if (res.status >= 400) {
      setStatus({ kind: 'error', message: `El login respondió con el código ${res.status}. Revisa la URL y las credenciales.` });
      return;
    }
    const found = findToken(res.text, tokenPath);
    if (!found.ok) setStatus({ kind: 'error', message: found.error.message });
    else deliver({ token: found.token, source: `campo «${found.path}» de la respuesta` });
  }

  async function authorize() {
    setResult(null);
    if (!tokenUrl.trim()) {
      setStatus({ kind: 'error', message: 'Escribe la URL del endpoint de token: se usa para canjear el código.' });
      return;
    }
    const state = randomString(16);
    const verifier = randomString(32);
    // La ventana se abre antes de cualquier espera para que el navegador no la bloquee.
    const popup = window.open('', 'devtools-oauth', 'popup,width=520,height=720');
    if (!popup) {
      setStatus({ kind: 'error', message: 'El navegador bloqueó la ventana emergente. Permite las ventanas emergentes de este sitio y vuelve a intentarlo.' });
      return;
    }
    const url = authorizeUrl({ authUrl, clientId, redirectUri, scope, audience, state, challenge: await codeChallenge(verifier), fragment });
    if (!url.ok) {
      popup.close();
      setStatus({ kind: 'error', message: url.error.message });
      return;
    }
    pending.current = { state, verifier, client: client(), redirectUri };
    popup.location.href = url.url;
    setStatus({ kind: 'loading', message: 'Esperando a que inicies sesión en la ventana emergente…' });
  }

  onCallback.current = (params) => {
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    const cb = parseCallback(params, p.state);
    if (!cb.ok) setStatus({ kind: 'error', message: cb.error.message });
    else void oauth(p.client, { type: 'authorization_code', code: cb.code, redirectUri: p.redirectUri, codeVerifier: p.verifier }, 'OAuth 2.0 · authorization code');
  };

  function stopWaiting() {
    pending.current = null;
    setStatus({ kind: 'idle' });
  }

  function obtain() {
    if (flow === 'login') void login();
    else if (flow === 'client_credentials') void oauth(client(), { type: 'client_credentials' }, 'OAuth 2.0 · client credentials');
    else if (flow === 'password') void oauth(client(), { type: 'password', username, password }, 'OAuth 2.0 · password');
    else void authorize();
  }

  async function copyRedirect() {
    setCopied(await copyText(redirectUri));
  }

  const loading = status.kind === 'loading';
  const isOAuth = flow !== 'login';
  const expiry = result && expiryText(result);
  const subject = result && decodeJwt(result.token)?.sub;

  return (
    <details className="w-full rounded-lg border border-slate-200 p-4 dark:border-slate-800">
      <summary className="cursor-pointer font-medium">Obtener un token</summary>
      <div className="mt-3 space-y-3">
        <div>
          <label htmlFor={ids.flow} className="block text-sm font-medium">
            Cómo obtenerlo
          </label>
          <select id={ids.flow} value={flow} onChange={(e) => setFlow(e.target.value as TokenFlow)} className={`mt-1 ${field}`} disabled={loading}>
            {FLOWS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
          <p className={`mt-1 text-sm ${muted}`}>{FLOWS.find((f) => f.id === flow)?.help}</p>
        </div>

        {flow === 'login' && (
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor={ids.method} className="block text-sm font-medium">
                Método
              </label>
              <select id={ids.method} value={loginMethod} onChange={(e) => setLoginMethod(e.target.value as Method)} className={`mt-1 font-mono ${field}`}>
                <option value="POST">POST</option>
                <option value="PUT">PUT</option>
                <option value="GET">GET</option>
              </select>
            </div>
            <TextField label="URL del login" value={loginUrl} onChange={setLoginUrl} placeholder="https://api.ejemplo.com/auth/login" />
            <div className="basis-full">
              <label htmlFor={ids.body} className="block text-sm font-medium">
                Cuerpo JSON {loginMethod === 'GET' && <span className={`font-normal ${muted}`}>(GET no lleva cuerpo: déjalo vacío)</span>}
              </label>
              <textarea id={ids.body} value={loginBody} onChange={(e) => setLoginBody(e.target.value)} spellCheck={false} autoComplete="off" className={`${area} mt-1 h-32`} />
            </div>
            <TextField
              label="Campo del token en la respuesta"
              value={tokenPath}
              onChange={setTokenPath}
              placeholder="automático"
              hint="Vacío: se busca en access_token, token, accessToken, data.token… También admite rutas como data.auth.jwt."
              wide
            />
          </div>
        )}

        {isOAuth && (
          <div className="flex flex-wrap items-end gap-3">
            {flow === 'authorization_code' && (
              <TextField label="URL de autorización" value={authUrl} onChange={setAuthUrl} placeholder="https://auth.ejemplo.com/authorize" wide />
            )}
            <TextField label="URL del endpoint de token" value={tokenUrl} onChange={setTokenUrl} placeholder="https://auth.ejemplo.com/oauth/token" wide />
            <TextField label="client_id" value={clientId} onChange={setClientId} />
            <TextField
              label={flow === 'client_credentials' ? 'client_secret' : 'client_secret (opcional)'}
              value={clientSecret}
              onChange={setClientSecret}
              type="password"
              hint={flow === 'authorization_code' ? 'Déjalo vacío si la aplicación es pública (SPA o móvil).' : undefined}
            />
            {flow === 'password' && (
              <>
                <TextField label="Usuario" value={username} onChange={setUsername} />
                <TextField label="Contraseña" value={password} onChange={setPassword} type="password" />
              </>
            )}
            <TextField label="scope (opcional)" value={scope} onChange={setScope} placeholder={flow === 'authorization_code' ? 'openid profile email' : 'read write'} />
            <TextField label="audience (opcional)" value={audience} onChange={setAudience} hint="Lo piden algunos proveedores, como Auth0." />
            {clientSecret && (
              <div>
                <label htmlFor={ids.clientAuth} className="block text-sm font-medium">
                  Enviar las credenciales del cliente
                </label>
                <select id={ids.clientAuth} value={clientAuth} onChange={(e) => setClientAuth(e.target.value as ClientAuth)} className={`mt-1 ${field}`}>
                  <option value="body">En el cuerpo (client_secret_post)</option>
                  <option value="basic">En la cabecera Basic (client_secret_basic)</option>
                </select>
              </div>
            )}
            {flow === 'authorization_code' && (
              <div className="basis-full space-y-2">
                <div>
                  <div className="flex items-center">
                    <label htmlFor={ids.redirect} className="text-sm font-medium">
                      URL de retorno (redirect URI)
                    </label>
                    <Tooltip text="Regístrala en tu proveedor como URL de retorno permitida; si no, rechazará el inicio de sesión." />
                  </div>
                  <div className="mt-1 flex gap-2">
                    <input id={ids.redirect} type="text" value={redirectUri} readOnly className={`min-w-0 flex-1 font-mono ${field}`} />
                    <button type="button" className={button} onClick={copyRedirect}>
                      {copied ? 'Copiada' : 'Copiar'}
                    </button>
                  </div>                </div>
                <label htmlFor={ids.fragment} className="flex items-center gap-2 text-sm">
                  <input id={ids.fragment} type="checkbox" checked={fragment} onChange={(e) => setFragment(e.target.checked)} className="size-4 accent-indigo-600" />
                  Recibir el código en el fragmento (#), que no llega al servidor de esta web. Solo si tu proveedor admite response_mode=fragment.
                </label>
              </div>
            )}
            {clientSecret && <p className="basis-full text-xs text-amber-700 dark:text-amber-400">⚠ El secreto se usa desde tu navegador: utilízalo solo con credenciales de prueba o de desarrollo.</p>}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {loading && flow === 'authorization_code' && pending.current ? (
            <button type="button" className={button} onClick={stopWaiting}>
              Cancelar
            </button>
          ) : (
            <button type="button" className={primary} onClick={obtain} disabled={loading}>
              {flow === 'authorization_code' ? 'Iniciar sesión y obtener token' : 'Obtener token'}
            </button>
          )}
          <p role="status" aria-live="polite" className={`text-sm ${muted}`}>
            {loading && status.message}
          </p>
        </div>
        {status.kind === 'error' && (
          <div role="alert" className={errorBox}>
            <p>{status.message}</p>
          </div>
        )}

        {result && (
          <div className="rounded-lg bg-green-50 p-3 text-sm text-green-900 dark:bg-green-950 dark:text-green-200">
            <p className="font-medium">✓ Token obtenido ({result.source}) y puesto en el campo «Token».</p>
            <p className="mt-1 break-all font-mono">{result.token.length > 48 ? `${result.token.slice(0, 48)}…` : result.token}</p>
            <p className="mt-1">
              {[result.info?.tokenType && `Tipo ${result.info.tokenType}`, expiry, result.info?.scope && `scope: ${result.info.scope}`, subject && `usuario (sub): ${subject}`]
                .filter(Boolean)
                .join(' · ')}
            </p>
            {result.info?.refreshToken && isOAuth && (
              <button
                type="button"
                className={`mt-2 ${button}`}
                disabled={loading}
                onClick={() => void oauth(client(), { type: 'refresh_token', refreshToken: result.info!.refreshToken! }, 'OAuth 2.0 · refresh token')}
              >
                Renovar con el refresh token
              </button>
            )}
          </div>
        )}
      </div>
    </details>
  );
}
