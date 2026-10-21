import { MAX_INPUT_BYTES, byteLength, formatBytes } from '../../lib/validation';

export type IndentOption = 2 | 4 | 8 | 'tab';

export interface JsonError {
  message: string;
  line?: number;
  column?: number;
}

export type JsonResult =
  | { ok: true; output: string; warning?: string }
  | { ok: false; error: JsonError };

const PRECISION_WARNING =
  'El texto tiene números de más de 15 dígitos. JavaScript puede redondearlos al procesar el JSON.';

/** Convierte una posición (índice) en línea y columna, empezando en 1. */
function locate(text: string, position: number): { line: number; column: number } {
  const end = Math.min(Math.max(position, 0), text.length);
  let line = 1;
  let column = 1;
  for (let i = 0; i < end; i++) {
    if (text[i] === '\n') {
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  return { line, column };
}

type Reason = 'end' | 'key' | 'comma' | 'unexpected';

interface Failure {
  position: number;
  reason: Reason;
}

/**
 * Validador mínimo que solo se usa cuando JSON.parse ya falló: localiza el error de forma
 * idéntica en todos los navegadores, porque sus mensajes nativos difieren y a veces no traen posición.
 */
function findFailure(t: string): Failure | undefined {
  let i = 0;
  const fail = (position: number, reason: Reason): never => {
    throw { position, reason } satisfies Failure;
  };
  const ws = () => {
    while (i < t.length && ' \n\r\t'.includes(t[i])) i++;
  };
  const needMore = () => {
    ws();
    if (i >= t.length) fail(t.length, 'end');
  };
  const string = () => {
    i++;
    for (;;) {
      if (i >= t.length) fail(t.length, 'end');
      const c = t[i];
      if (c === '"') {
        i++;
        return;
      }
      if (c === '\\') {
        const next = t[i + 1];
        if (next === undefined) fail(t.length, 'end');
        if (next === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(t.slice(i + 2, i + 6))) fail(i, 'unexpected');
          i += 6;
        } else if ('"\\/bfnrt'.includes(next)) {
          i += 2;
        } else {
          fail(i, 'unexpected');
        }
      } else if (c < ' ') {
        fail(i, 'unexpected');
      } else {
        i++;
      }
    }
  };
  const value = (): void => {
    needMore();
    const c = t[i];
    if (c === '{') {
      i++;
      ws();
      if (t[i] === '}') {
        i++;
        return;
      }
      for (;;) {
        needMore();
        if (t[i] !== '"') fail(i, 'key');
        string();
        needMore();
        if (t[i] !== ':') fail(i, 'unexpected');
        i++;
        value();
        needMore();
        if (t[i] === ',') {
          i++;
          continue;
        }
        if (t[i] === '}') {
          i++;
          return;
        }
        fail(i, 'comma');
      }
    } else if (c === '[') {
      i++;
      ws();
      if (t[i] === ']') {
        i++;
        return;
      }
      for (;;) {
        value();
        needMore();
        if (t[i] === ',') {
          i++;
          continue;
        }
        if (t[i] === ']') {
          i++;
          return;
        }
        fail(i, 'comma');
      }
    } else if (c === '"') {
      string();
    } else {
      const literal = ['true', 'false', 'null'].find((l) => t.startsWith(l, i));
      if (literal) {
        i += literal.length;
        return;
      }
      const number = /-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/y;
      number.lastIndex = i;
      const m = number.exec(t);
      if (!m) fail(i, 'unexpected');
      else i += m[0].length;
    }
  };
  try {
    value();
    ws();
    if (i < t.length) fail(i, 'unexpected');
  } catch (e) {
    // Un RangeError (anidación extrema) o cualquier otro fallo interno: sin ubicación.
    return typeof e === 'object' && e !== null && 'reason' in e ? (e as Failure) : undefined;
  }
  return undefined;
}

const MESSAGES: Record<Reason, string> = {
  end: 'El JSON está incompleto: falta cerrar una llave, un corchete o unas comillas.',
  key: 'Se esperaba una clave entre comillas dobles. Revisa que no haya una coma de más después del último elemento.',
  comma: 'Falta una coma entre elementos, o sobra algún símbolo.',
  unexpected: 'El JSON no es válido: hay un carácter o símbolo inesperado.',
};

function describeError(text: string): JsonError {
  const failure = findFailure(text);
  if (!failure) return { message: 'El JSON no es válido.' };
  return { message: MESSAGES[failure.reason], ...locate(text, failure.position) };
}

function parse(input: string): { ok: true; value: unknown; text: string } | { ok: false; error: JsonError } {
  const text = input.replace(/^\uFEFF/, '');
  if (text.trim() === '') {
    return { ok: false, error: { message: 'Escribe o pega un JSON para continuar.' } };
  }
  const size = byteLength(text);
  if (size > MAX_INPUT_BYTES) {
    return {
      ok: false,
      error: { message: `El texto pesa ${formatBytes(size)} y el máximo es ${formatBytes(MAX_INPUT_BYTES)}.` },
    };
  }
  try {
    return { ok: true, value: JSON.parse(text), text };
  } catch {
    return { ok: false, error: describeError(text) };
  }
}

/** Ordena las claves de los objetos de forma recursiva; los arreglos conservan su orden. */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    // fromEntries define propiedades propias, así que una clave «__proto__» del JSON no altera el prototipo.
    return Object.fromEntries(Object.keys(obj).sort().map((k) => [k, sortKeysDeep(obj[k])]));
  }
  return value;
}

function run(input: string, indent: string | number | undefined, sortKeys = false): JsonResult {
  const parsed = parse(input);
  if (!parsed.ok) return parsed;
  const output = JSON.stringify(sortKeys ? sortKeysDeep(parsed.value) : parsed.value, null, indent);
  return /\d{16,}/.test(parsed.text) ? { ok: true, output, warning: PRECISION_WARNING } : { ok: true, output };
}

export function formatJson(input: string, indent: IndentOption = 2, sortKeys = false): JsonResult {
  return run(input, indent === 'tab' ? '\t' : indent, sortKeys);
}

export function minifyJson(input: string): JsonResult {
  return run(input, undefined);
}

/** Solo valida; no devuelve salida. */
export function validateJson(input: string): { valid: true } | { valid: false; error: JsonError } {
  const parsed = parse(input);
  return parsed.ok ? { valid: true } : { valid: false, error: parsed.error };
}

export const JSON_EXAMPLES = [
  {
    label: 'Objeto simple',
    value: '{"nombre":"Ana","edad":30,"activa":true,"apodo":null}',
  },
  {
    label: 'Anidado con arreglos',
    value:
      '{"usuario":{"id":1,"roles":["admin","editor"],"direccion":{"ciudad":"Lima","cp":"15001"}},"tags":[],"precio":19.99}',
  },
  {
    label: 'JSON con error',
    value: '{\n  "nombre": "Ana",\n  "edad": 30,\n}',
  },
] as const;
