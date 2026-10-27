import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  authorizeUrl,
  codeChallenge,
  decodeJwt,
  findToken,
  getPath,
  loginRequest,
  parseCallback,
  parseTokenResponse,
  randomString,
  tokenRequest,
  type OAuthClient,
} from './token';

const client = (patch: Partial<OAuthClient> = {}): OAuthClient => ({
  tokenUrl: 'https://auth.ejemplo.com/oauth/token',
  clientId: 'mi-app',
  clientSecret: 's3creto',
  scope: 'read write',
  audience: '',
  clientAuth: 'body',
  ...patch,
});

function form(r: ReturnType<typeof tokenRequest>) {
  if (!r.ok) throw new Error(r.error.message);
  return Object.fromEntries(new URLSearchParams(r.request.body));
}

const errorOf = (r: { ok: boolean; error?: { message: string } }) => {
  if (r.ok) throw new Error('se esperaba un error');
  return r.error!.message;
};

describe('tokenRequest', () => {
  it('client credentials con el secreto en el cuerpo', () => {
    const r = tokenRequest(client(), { type: 'client_credentials' });
    expect(form(r)).toEqual({ grant_type: 'client_credentials', scope: 'read write', client_id: 'mi-app', client_secret: 's3creto' });
    if (r.ok) {
      expect(r.request.method).toBe('POST');
      expect(r.request.headers).toContainEqual(['Accept', 'application/json']);
      expect(r.request.headers).toContainEqual(['Content-Type', 'application/x-www-form-urlencoded;charset=UTF-8']);
    }
  });

  it('client credentials con cabecera Basic', () => {
    const r = tokenRequest(client({ clientAuth: 'basic', audience: 'https://api' }), { type: 'client_credentials' });
    expect(form(r)).toEqual({ grant_type: 'client_credentials', scope: 'read write', audience: 'https://api' });
    if (r.ok) expect(r.request.headers).toContainEqual(['Authorization', `Basic ${btoa('mi-app:s3creto')}`]);
  });

  it('password sin secreto (cliente público)', () => {
    const r = tokenRequest(client({ clientSecret: '', clientAuth: 'basic' }), { type: 'password', username: 'ana', password: 'x' });
    expect(form(r)).toEqual({ grant_type: 'password', username: 'ana', password: 'x', scope: 'read write', client_id: 'mi-app' });
  });

  it('authorization code envía el verificador PKCE y no el scope', () => {
    const r = tokenRequest(client({ clientSecret: '' }), { type: 'authorization_code', code: 'abc', redirectUri: 'https://d/cb/', codeVerifier: 'v' });
    expect(form(r)).toEqual({ grant_type: 'authorization_code', code: 'abc', redirect_uri: 'https://d/cb/', code_verifier: 'v', client_id: 'mi-app' });
  });

  it('refresh token', () => {
    expect(form(tokenRequest(client(), { type: 'refresh_token', refreshToken: 'r1' }))).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'r1' });
  });

  it('pide los datos obligatorios', () => {
    expect(errorOf(tokenRequest(client({ tokenUrl: ' ' }), { type: 'client_credentials' }))).toContain('URL');
    expect(errorOf(tokenRequest(client({ clientId: '' }), { type: 'client_credentials' }))).toContain('client_id');
    expect(errorOf(tokenRequest(client({ clientSecret: '' }), { type: 'client_credentials' }))).toContain('client_secret');
    expect(errorOf(tokenRequest(client(), { type: 'password', username: '', password: '' }))).toContain('usuario');
  });
});

describe('loginRequest', () => {
  it('envía JSON solo si hay cuerpo', () => {
    const post = loginRequest('POST', 'https://a.com/login', '{"u":"ana"}');
    expect(post.ok && post.request.body).toBe('{"u":"ana"}');
    const get = loginRequest('GET', 'https://a.com/token', '');
    expect(get.ok && get.request.body).toBeUndefined();
    expect(loginRequest('POST', 'https://a.com', '{roto').ok).toBe(false);
  });
});

describe('parseTokenResponse', () => {
  it('lee una respuesta OAuth en JSON', () => {
    const r = parseTokenResponse(200, '{"access_token":"t","token_type":"Bearer","expires_in":3600,"refresh_token":"r","scope":"read"}');
    expect(r).toEqual({ ok: true, token: { accessToken: 't', tokenType: 'Bearer', expiresIn: 3600, refreshToken: 'r', scope: 'read' } });
  });

  it('acepta respuestas en formato formulario', () => {
    expect(parseTokenResponse(200, 'access_token=t&token_type=bearer&scope=repo')).toMatchObject({ ok: true, token: { accessToken: 't', scope: 'repo' } });
  });

  it('explica los errores del proveedor', () => {
    expect(errorOf(parseTokenResponse(400, '{"error":"invalid_client","error_description":"Bad secret"}'))).toContain('invalid_client: Bad secret');
    expect(errorOf(parseTokenResponse(500, '<html>'))).toContain('500');
    expect(errorOf(parseTokenResponse(200, '{"token":"x"}'))).toContain('access_token');
  });
});

describe('findToken y getPath', () => {
  it('getPath recorre objetos y arreglos', () => {
    expect(getPath({ a: { b: [{ c: 1 }] } }, 'a.b[0].c')).toBe(1);
    expect(getPath({ a: 1 }, 'a.b.c')).toBeUndefined();
  });

  it('encuentra el token en los campos habituales', () => {
    expect(findToken('{"token":"abc"}', '')).toEqual({ ok: true, token: 'abc', path: 'token' });
    expect(findToken('{"data":{"accessToken":"xyz"}}', '')).toMatchObject({ token: 'xyz', path: 'data.accessToken' });
  });

  it('usa la ruta indicada', () => {
    expect(findToken('{"auth":{"jwt":"j"}}', 'auth.jwt')).toMatchObject({ token: 'j' });
    expect(errorOf(findToken('{"auth":{}}', 'auth.jwt'))).toContain('auth.jwt');
  });

  it('avisa si no es JSON o no encuentra nada', () => {
    expect(errorOf(findToken('hola', ''))).toContain('no es JSON');
    expect(errorOf(findToken('{"ok":true}', ''))).toContain('campos habituales');
  });
});

describe('PKCE y autorización', () => {
  it('randomString genera base64url distinto cada vez', () => {
    const a = randomString();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomString()).not.toBe(a);
  });

  it('codeChallenge es SHA-256 en base64url', async () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    expect(await codeChallenge(verifier)).toBe(createHash('sha256').update(verifier).digest('base64url'));
  });

  it('authorizeUrl incluye los parámetros de PKCE', () => {
    const r = authorizeUrl({
      authUrl: 'https://auth.ejemplo.com/authorize?prompt=login',
      clientId: 'app',
      redirectUri: 'https://tools.ejemplo/cb/',
      scope: 'openid profile',
      audience: '',
      state: 'st',
      challenge: 'ch',
      fragment: true,
    });
    if (!r.ok) throw new Error(r.error.message);
    const p = new URL(r.url).searchParams;
    expect(Object.fromEntries(p)).toEqual({
      prompt: 'login',
      response_type: 'code',
      client_id: 'app',
      redirect_uri: 'https://tools.ejemplo/cb/',
      state: 'st',
      code_challenge: 'ch',
      code_challenge_method: 'S256',
      scope: 'openid profile',
      response_mode: 'fragment',
    });
  });

  it('parseCallback comprueba state y errores', () => {
    expect(parseCallback({ code: 'c', state: 's' }, 's')).toEqual({ ok: true, code: 'c' });
    expect(errorOf(parseCallback({ code: 'c', state: 'otro' }, 's'))).toContain('state');
    expect(errorOf(parseCallback({ error: 'access_denied', state: 's' }, 's'))).toContain('access_denied');
    expect(errorOf(parseCallback({ state: 's' }, 's'))).toContain('código');
  });
});

describe('decodeJwt', () => {
  it('lee exp, sub e iss', () => {
    const payload = Buffer.from(JSON.stringify({ sub: 'ana', exp: 2000000000, iss: 'https://auth' })).toString('base64url');
    expect(decodeJwt(`e30.${payload}.firma`)).toEqual({ sub: 'ana', exp: 2000000000, iss: 'https://auth' });
  });

  it('devuelve null si no es un JWT', () => {
    expect(decodeJwt('opaco')).toBeNull();
    expect(decodeJwt('a.%%%.c')).toBeNull();
  });
});
