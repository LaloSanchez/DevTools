import { describe, expect, it } from 'vitest';
import {
  MAX_BODY_BYTES,
  buildRequest,
  decodeBody,
  describeFetchError,
  emptySpec,
  isTextType,
  parseUrl,
  prettyBody,
  readLimited,
  statusText,
  toCurl,
  type RequestSpec,
} from './api-tester';

const spec = (patch: Partial<RequestSpec>): RequestSpec => ({ ...emptySpec(), url: 'https://api.ejemplo.com/x', ...patch });
const pair = (key: string, value: string, enabled = true) => ({ key, value, enabled });

function built(patch: Partial<RequestSpec>) {
  const r = buildRequest(spec(patch));
  if (!r.ok) throw new Error(r.error.message);
  return r;
}

function errorOf(patch: Partial<RequestSpec>) {
  const r = buildRequest(spec(patch));
  if (r.ok) throw new Error('se esperaba un error');
  return r.error.message;
}

describe('parseUrl', () => {
  it('acepta http y https', () => {
    expect(parseUrl('https://a.com/b')).toMatchObject({ ok: true, added: false });
    expect(parseUrl('  http://a.com  ')).toMatchObject({ ok: true });
  });

  it('añade https:// si falta, y http:// para localhost', () => {
    const a = parseUrl('api.ejemplo.com/v1');
    expect(a.ok && a.url.href).toBe('https://api.ejemplo.com/v1');
    const b = parseUrl('localhost:3000/salud');
    expect(b.ok && b.url.href).toBe('http://localhost:3000/salud');
    const c = parseUrl('127.0.0.1:8080');
    expect(c.ok && c.url.protocol).toBe('http:');
  });

  it('quita el fragmento', () => {
    const r = parseUrl('https://a.com/x#seccion');
    expect(r.ok && r.url.href).toBe('https://a.com/x');
  });

  it('rechaza URL vacía, inválida, otros esquemas y credenciales', () => {
    expect(parseUrl('   ').ok).toBe(false);
    expect(parseUrl('https://').ok).toBe(false);
    expect(parseUrl('ftp://a.com').ok).toBe(false);
    const r = parseUrl('https://ana:secreto@a.com');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain('Autenticación');
  });
});

describe('buildRequest: URL y parámetros', () => {
  it('añade los parámetros activos a la query, codificados', () => {
    const r = built({ url: 'https://a.com/b?x=1', params: [pair('q', 'hola mundo'), pair('off', '1', false), pair('  ', 'v'), pair('ñ', '&')] });
    expect(r.request.url).toBe('https://a.com/b?x=1&q=hola+mundo&%C3%B1=%26');
  });

  it('avisa de http:// fuera de localhost, pero no en localhost', () => {
    expect(built({ url: 'http://a.com' }).warnings.join()).toContain('bloquea');
    expect(built({ url: 'http://localhost:3000' }).warnings).toEqual([]);
  });

  it('avisa cuando añade el esquema', () => {
    expect(built({ url: 'a.com' }).warnings[0]).toContain('https://');
  });
});

describe('buildRequest: cabeceras', () => {
  it('incluye solo las activas y con nombre', () => {
    const r = built({ headers: [pair('Accept', 'application/json'), pair('X-Off', '1', false), pair('', 'x')] });
    expect(r.request.headers).toEqual([['Accept', 'application/json']]);
  });

  it('rechaza nombres y valores inválidos', () => {
    expect(errorOf({ headers: [pair('Mi Cabecera', 'x')] })).toContain('no es válido');
    expect(errorOf({ headers: [pair('X', 'a\nb')] })).toContain('saltos de línea');
    expect(errorOf({ headers: [pair('X', 'café ☕')] })).toContain('no admite');
  });

  it('ignora con aviso las cabeceras prohibidas por el navegador', () => {
    const r = built({ headers: [pair('Cookie', 'a=1'), pair('Sec-Fetch-Mode', 'x'), pair('Proxy-Authorization', 'x'), pair('X-Ok', '1')] });
    expect(r.request.headers).toEqual([['X-Ok', '1']]);
    expect(r.warnings).toHaveLength(3);
  });
});

describe('buildRequest: autenticación', () => {
  it('añade Bearer', () => {
    const r = built({ auth: { kind: 'bearer', token: ' abc.def ' } });
    expect(r.request.headers).toEqual([['Authorization', 'Bearer abc.def']]);
  });

  it('añade Basic codificado en UTF-8', () => {
    const r = built({ auth: { kind: 'basic', user: 'José', password: 'p:ss' } });
    expect(r.request.headers[0][1]).toBe(`Basic ${Buffer.from('José:p:ss', 'utf8').toString('base64')}`);
  });

  it('pide los datos que faltan', () => {
    expect(errorOf({ auth: { kind: 'bearer', token: '' } })).toContain('token');
    expect(errorOf({ auth: { kind: 'bearer', token: 'a b' } })).toContain('espacios');
    expect(errorOf({ auth: { kind: 'basic', user: '', password: 'x' } })).toContain('usuario');
  });

  it('respeta la cabecera Authorization escrita a mano', () => {
    const r = built({ headers: [pair('authorization', 'Token 1')], auth: { kind: 'bearer', token: 'x' } });
    expect(r.request.headers).toEqual([['authorization', 'Token 1']]);
    expect(r.warnings[0]).toContain('Authorization');
  });
});

describe('buildRequest: cuerpo', () => {
  it('sin cuerpo no envía body ni Content-Type', () => {
    const r = built({ method: 'POST', body: 'ignorado' });
    expect(r.request.body).toBeUndefined();
    expect(r.request.headers).toEqual([]);
  });

  it('valida el JSON y fija Content-Type', () => {
    const r = built({ method: 'POST', bodyMode: 'json', body: '{"a":1}' });
    expect(r.request.body).toBe('{"a":1}');
    expect(r.request.headers).toEqual([['Content-Type', 'application/json']]);
    expect(errorOf({ method: 'POST', bodyMode: 'json', body: '{a:1}' })).toContain('no es JSON válido');
    expect(errorOf({ method: 'POST', bodyMode: 'json', body: '  ' })).toContain('Escribe el cuerpo');
  });

  it('no sustituye un Content-Type escrito a mano', () => {
    const r = built({ method: 'PUT', bodyMode: 'json', body: '[]', headers: [pair('content-type', 'application/vnd.api+json')] });
    expect(r.request.headers).toEqual([['content-type', 'application/vnd.api+json']]);
  });

  it('texto vacío no envía cuerpo', () => {
    expect(built({ method: 'POST', bodyMode: 'text', body: '' }).request.body).toBeUndefined();
    expect(built({ method: 'POST', bodyMode: 'text', body: 'hola' }).request.headers[0][1]).toContain('text/plain');
  });

  it('codifica el formulario', () => {
    const r = built({ method: 'POST', bodyMode: 'form', form: [pair('nombre', 'Ana María'), pair('x', '1', false), pair('e', 'a&b')] });
    expect(r.request.body).toBe('nombre=Ana+Mar%C3%ADa&e=a%26b');
    expect(r.request.headers[0][1]).toContain('x-www-form-urlencoded');
  });

  it('rechaza cuerpo en GET y HEAD', () => {
    expect(errorOf({ method: 'GET', bodyMode: 'text', body: 'x' })).toContain('GET');
    expect(errorOf({ method: 'HEAD', bodyMode: 'json', body: '{}' })).toContain('HEAD');
  });

  it('rechaza cuerpos que superan el límite', () => {
    expect(errorOf({ method: 'POST', bodyMode: 'text', body: 'a'.repeat(MAX_BODY_BYTES + 1) })).toContain('máximo');
  });
});

describe('toCurl', () => {
  it('genera un GET simple', () => {
    expect(toCurl({ method: 'GET', url: 'https://a.com/x?y=1', headers: [] })).toBe("curl 'https://a.com/x?y=1'");
  });

  it('incluye método, cabeceras y cuerpo, y escapa comillas simples', () => {
    const c = toCurl({ method: 'POST', url: 'https://a.com', headers: [['Content-Type', 'application/json']], body: `{"t":"it's"}` });
    expect(c).toBe(`curl -X POST 'https://a.com' \\\n  -H 'Content-Type: application/json' \\\n  --data-raw '{"t":"it'\\''s"}'`);
  });

  it('usa --head para HEAD', () => {
    expect(toCurl({ method: 'HEAD', url: 'https://a.com', headers: [] })).toContain('--head');
  });
});

describe('respuesta', () => {
  it('readLimited lee todo si cabe y recorta si no', async () => {
    const all = await readLimited(new Response('hola mundo'), 100);
    expect(new TextDecoder().decode(all.bytes)).toBe('hola mundo');
    expect(all.truncated).toBe(false);
    const cut = await readLimited(new Response('hola mundo'), 4);
    expect(new TextDecoder().decode(cut.bytes)).toBe('hola');
    expect(cut.truncated).toBe(true);
    expect((await readLimited(new Response(null), 10)).bytes.length).toBe(0);
  });

  it('isTextType distingue texto de binario', () => {
    for (const t of ['application/json; charset=utf-8', 'application/problem+json', 'text/html', 'application/xml', 'image/svg+xml', '']) {
      expect(isTextType(t)).toBe(true);
    }
    for (const t of ['image/png', 'application/pdf', 'application/octet-stream']) expect(isTextType(t)).toBe(false);
  });

  it('decodeBody respeta el charset y recurre a UTF-8', () => {
    expect(decodeBody(new Uint8Array([0xe9]), 'text/plain; charset=iso-8859-1')).toBe('é');
    expect(decodeBody(new TextEncoder().encode('ñ'), 'text/plain; charset=desconocido')).toBe('ñ');
  });

  it('prettyBody formatea JSON y deja lo demás', () => {
    expect(prettyBody('{"a":1}', 'application/json')?.output).toBe('{\n  "a": 1\n}');
    expect(prettyBody('[1]', 'text/plain')?.output).toBe('[\n  1\n]');
    expect(prettyBody('<p>hola</p>', 'text/html')).toBeNull();
    expect(prettyBody('{roto', 'application/json')).toBeNull();
    expect(prettyBody('{"n":12345678901234567890}', 'application/json')?.warning).toBeTruthy();
  });

  it('statusText completa el texto que falta', () => {
    expect(statusText(404)).toBe('Not Found');
    expect(statusText(200, 'Todo bien')).toBe('Todo bien');
    expect(statusText(299)).toBe('');
  });

  it('describeFetchError explica cada caso', () => {
    expect(describeFetchError(null, 'cancel')).toBe('Petición cancelada.');
    expect(describeFetchError(null, 'timeout')).toContain('30 segundos');
    expect(describeFetchError(new TypeError('Failed to fetch'), null)).toContain('CORS');
  });
});
