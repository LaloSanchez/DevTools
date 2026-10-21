import { describe, expect, it } from 'vitest';
import { formatJson, minifyJson, validateJson } from './json-formatter';
import { MAX_INPUT_BYTES } from '../../lib/validation';

describe('formatJson', () => {
  it('formatea JSON válido con 2 espacios por defecto', () => {
    const r = formatJson('{"a":1,"b":[1,2]}');
    expect(r).toEqual({ ok: true, output: '{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}' });
  });

  it('respeta 4 espacios, 8 espacios y tabulador', () => {
    const src = '{"a":1}';
    expect(formatJson(src, 4)).toMatchObject({ output: '{\n    "a": 1\n}' });
    expect(formatJson(src, 8)).toMatchObject({ output: '{\n        "a": 1\n}' });
    expect(formatJson(src, 'tab')).toMatchObject({ output: '{\n\t"a": 1\n}' });
  });

  it('maneja objetos y arreglos anidados', () => {
    const r = formatJson('{"a":{"b":[{"c":[]},{}]}}');
    expect(r.ok).toBe(true);
    if (r.ok) expect(JSON.parse(r.output)).toEqual({ a: { b: [{ c: [] }, {}] } });
  });

  it('conserva strings con caracteres escapados', () => {
    const src = '{"t":"línea1\\nlínea2\\t\\"comilla\\" \\\\ \\u00e9"}';
    const r = formatJson(src);
    expect(r.ok).toBe(true);
    if (r.ok) expect(JSON.parse(r.output)).toEqual(JSON.parse(src));
  });

  it('acepta null, booleanos, números y primitivos sueltos', () => {
    expect(formatJson('null')).toEqual({ ok: true, output: 'null' });
    expect(formatJson('true')).toEqual({ ok: true, output: 'true' });
    expect(formatJson('-1.5e3')).toEqual({ ok: true, output: '-1500' });
    expect(formatJson('"hola"')).toEqual({ ok: true, output: '"hola"' });
    expect(formatJson('{"a":null,"b":false,"c":0}')).toMatchObject({ ok: true });
  });

  it('ignora el BOM inicial y los espacios alrededor', () => {
    expect(formatJson('\uFEFF  {"a":1}  \n')).toMatchObject({ ok: true });
  });

  it('avisa si hay números con más de 15 dígitos', () => {
    const r = formatJson('{"id":12345678901234567890}');
    expect(r.ok && r.warning).toBeTruthy();
    const normal = formatJson('{"id":123}');
    expect(normal.ok && normal.warning).toBeFalsy();
  });
});

describe('formatJson con sortKeys', () => {
  it('ordena claves de forma recursiva y conserva el orden de los arreglos', () => {
    const r = formatJson('{"b":1,"a":{"d":1,"c":[{"z":1,"y":2},3,1]}}', 2, true);
    expect(r.ok && r.output).toBe(
      '{\n  "a": {\n    "c": [\n      {\n        "y": 2,\n        "z": 1\n      },\n      3,\n      1\n    ],\n    "d": 1\n  },\n  "b": 1\n}',
    );
  });

  it('una clave __proto__ del JSON no contamina el prototipo', () => {
    const r = formatJson('{"b":1,"__proto__":{"x":1}}', 2, true);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.output).toContain('"__proto__"');
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });
});

describe('minifyJson', () => {
  it('elimina espacios y saltos de línea', () => {
    expect(minifyJson('{\n  "a": 1,\n  "b": [1, 2]\n}')).toEqual({ ok: true, output: '{"a":1,"b":[1,2]}' });
  });

  it('no modifica el contenido de los strings', () => {
    expect(minifyJson('{ "a": "  dos  espacios " }')).toEqual({ ok: true, output: '{"a":"  dos  espacios "}' });
  });
});

describe('entradas inválidas (sin lanzar excepciones)', () => {
  it.each(['', '   ', '\n\t'])('trata la entrada vacía %j como error amable', (input) => {
    const r = formatJson(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/Escribe o pega/);
  });

  it.each(['{', '{"a":}', "{'a':1}", '{"a":1,}', '[1,2', 'undefined', '{"a":1} extra'])(
    'rechaza %j',
    (input) => {
      expect(() => formatJson(input)).not.toThrow();
      expect(() => minifyJson(input)).not.toThrow();
      expect(formatJson(input).ok).toBe(false);
    },
  );

  it('informa la línea del error en JSON de varias líneas', () => {
    const r = formatJson('{\n  "a": 1,\n  "b": }');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.line).toBe(3);
      expect(r.error.column).toBeGreaterThan(0);
    }
  });

  it('describe un JSON incompleto', () => {
    const r = formatJson('{"a": [1, 2');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/incompleto/);
  });

  it('no filtra el mensaje técnico del motor en el texto al usuario', () => {
    const r = formatJson('{"a":}');
    if (!r.ok) expect(r.error.message).not.toMatch(/JSON\.parse|position \d+/);
  });

  it('rechaza entradas por encima del límite de tamaño', () => {
    const big = '"' + 'a'.repeat(MAX_INPUT_BYTES) + '"';
    const r = formatJson(big);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/máximo/);
  });
});

describe('validateJson', () => {
  it('distingue válido de inválido', () => {
    expect(validateJson('{"a":1}')).toEqual({ valid: true });
    expect(validateJson('{a:1}').valid).toBe(false);
  });
});
