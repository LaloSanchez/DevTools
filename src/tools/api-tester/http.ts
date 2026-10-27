import type { BuiltRequest } from './api-tester';

/**
 * Única petición de red del sitio: va solo a la URL que escribe el usuario, directamente desde su navegador,
 * sin cookies ni Referer. La usan el probador de APIs y la obtención de tokens.
 */
export function sendRequest(req: BuiltRequest, signal: AbortSignal): Promise<Response> {
  return fetch(req.url, {
    method: req.method,
    headers: req.headers,
    body: req.body,
    signal,
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    cache: 'no-store',
    redirect: 'follow',
  });
}
