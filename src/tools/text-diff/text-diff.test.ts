import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OPTIONS,
  MAX_DIFF_BYTES,
  compareTexts,
  splitLines,
  toPlainDiff,
  withContext,
  type DiffOptions,
  type DiffRow,
} from './text-diff';

const text = (o: Partial<DiffOptions> = {}): DiffOptions => ({ ...DEFAULT_OPTIONS, mode: 'text', ...o });
const run = (l: string, r: string, o: Partial<DiffOptions> = {}) => {
  const res = compareTexts(l, r, text(o));
  if (!res.ok) throw new Error(res.error);
  return res;
};
const types = (rows: DiffRow[]) => rows.map((r) => r.type);

describe('splitLines', () => {
  it('maneja CRLF, CR y LF', () => {
    expect(splitLines('a\r\nb\rc\nd')).toEqual(['a', 'b', 'c', 'd']);
  });
  it('un salto final no crea una línea vacía, pero sí las vacías intermedias', () => {
    expect(splitLines('a\nb\n')).toEqual(['a', 'b']);
    expect(splitLines('a\n\nb')).toEqual(['a', '', 'b']);
    expect(splitLines('a\n\n')).toEqual(['a', '']);
    expect(splitLines('')).toEqual([]);
  });
});

describe('compareTexts: textos iguales y distintos', () => {
  it('detecta textos idénticos', () => {
    const r = run('uno\ndos\ntres', 'uno\ndos\ntres');
    expect(r.identical).toBe(true);
    expect(r.stats).toEqual({ added: 0, removed: 0, modified: 0, equal: 3 });
  });

  it('cuenta líneas añadidas', () => {
    const r = run('a\nb', 'a\nb\nc');
    expect(r.stats).toMatchObject({ added: 1, removed: 0, modified: 0, equal: 2 });
    expect(r.rows[2]).toEqual({ type: 'added', newNo: 3, text: 'c' });
  });

  it('cuenta líneas eliminadas', () => {
    const r = run('a\nb\nc', 'a\nc');
    expect(r.stats).toMatchObject({ added: 0, removed: 1, modified: 0, equal: 2 });
    expect(r.rows[1]).toEqual({ type: 'removed', oldNo: 2, text: 'b' });
  });

  it('empareja una línea cambiada como modificada, con palabras resaltadas', () => {
    const r = run('Color: rojo\nfin', 'Color: azul\nfin');
    expect(r.stats).toMatchObject({ modified: 1, added: 0, removed: 0, equal: 1 });
    const row = r.rows[0];
    expect(row.type).toBe('modified');
    if (row.type === 'modified') {
      expect(row.oldSegments.filter((s) => s.changed).map((s) => s.text)).toEqual(['rojo']);
      expect(row.newSegments.filter((s) => s.changed).map((s) => s.text)).toEqual(['azul']);
      expect(row.oldNo).toBe(1);
      expect(row.newNo).toBe(1);
    }
  });

  it('no empareja líneas totalmente distintas: las muestra como eliminada y añadida', () => {
    const r = run('abcdefghij', 'zzzzzzzzzz');
    expect(r.stats).toMatchObject({ modified: 0, removed: 1, added: 1 });
    expect(types(r.rows)).toEqual(['removed', 'added']);
  });

  it('mantiene los números de línea correctos de cada lado tras inserciones', () => {
    const r = run('a\nb\nc', 'x\ny\na\nb\nc');
    const equal = r.rows.filter((x) => x.type === 'equal');
    expect(equal).toEqual([
      { type: 'equal', oldNo: 1, newNo: 3, text: 'a' },
      { type: 'equal', oldNo: 2, newNo: 4, text: 'b' },
      { type: 'equal', oldNo: 3, newNo: 5, text: 'c' },
    ]);
  });

  it('un lado vacío marca todo como añadido o eliminado', () => {
    expect(run('', 'a\nb').stats).toMatchObject({ added: 2, removed: 0 });
    expect(run('a\nb', '').stats).toMatchObject({ added: 0, removed: 2 });
  });

  it('las líneas en blanco intermedias cuentan', () => {
    expect(run('a\nb', 'a\n\nb').stats).toMatchObject({ added: 1 });
  });
});

describe('compareTexts: opciones', () => {
  it('ignorar mayúsculas y minúsculas', () => {
    expect(run('Hola Mundo', 'hola mundo').identical).toBe(false);
    expect(run('Hola Mundo', 'hola mundo', { ignoreCase: true }).identical).toBe(true);
  });

  it('ignorar espacios: colapsa internos y recorta extremos', () => {
    expect(run('a  b\n   c  ', 'a b\nc', { ignoreWhitespace: false }).identical).toBe(false);
    expect(run('a  b\n   c  ', 'a b\nc', { ignoreWhitespace: true }).identical).toBe(true);
    expect(run('a\tb', 'a b', { ignoreWhitespace: true }).identical).toBe(true);
  });

  it('ignorar espacios no oculta cambios reales', () => {
    expect(run('a  b', 'a  c', { ignoreWhitespace: true }).identical).toBe(false);
  });

  it('ambas opciones a la vez', () => {
    expect(run('  HOLA   mundo ', 'hola mundo', { ignoreCase: true, ignoreWhitespace: true }).identical).toBe(true);
  });

  it('CRLF y LF se consideran iguales, y el salto final no es una diferencia', () => {
    expect(run('a\r\nb\r\n', 'a\nb').identical).toBe(true);
  });
});

describe('compareTexts: modo JSON', () => {
  const json = (l: string, r: string, o: Partial<DiffOptions> = {}) => compareTexts(l, r, { ...DEFAULT_OPTIONS, mode: 'json', ...o });

  it('normaliza el formato: minificado y con sangría son iguales', () => {
    const r = json('{"a":1,"b":[1,2]}', '{\n    "a": 1,\n    "b": [ 1, 2 ]\n}');
    expect(r.ok && r.identical).toBe(true);
  });

  it('ignora el orden de las claves por defecto', () => {
    const r = json('{"a":1,"b":2}', '{"b":2,"a":1}');
    expect(r.ok && r.identical).toBe(true);
  });

  it('puede respetar el orden de las claves', () => {
    const r = json('{"a":1,"b":2}', '{"b":2,"a":1}', { sortKeys: false });
    expect(r.ok && r.identical).toBe(false);
  });

  it('el orden de los arreglos sí importa', () => {
    const r = json('[1,2,3]', '[3,2,1]');
    expect(r.ok && r.identical).toBe(false);
  });

  it('detecta diferencias de valores', () => {
    const r = json('{"edad":30,"n":"Ana"}', '{"n":"Ana","edad":31}');
    expect(r.ok && r.stats).toMatchObject({ modified: 1, equal: 3 });
  });

  it('indica qué lado tiene el JSON inválido, con ubicación', () => {
    const left = json('{"a":1,}', '{"a":1}');
    expect(left.ok).toBe(false);
    if (!left.ok) expect(left.error).toMatch(/lado izquierdo.*línea 1/);
    const right = json('{"a":1}', '{"a":');
    expect(right.ok).toBe(false);
    if (!right.ok) expect(right.error).toMatch(/lado derecho/);
  });

  it('no lanza con entradas inválidas', () => {
    expect(() => json('no es json', '{}')).not.toThrow();
  });
});

describe('compareTexts: validaciones', () => {
  it('pide contenido si ambos lados están vacíos', () => {
    const r = compareTexts('  ', '\n', DEFAULT_OPTIONS);
    expect(r.ok).toBe(false);
  });

  it('rechaza textos por encima del límite', () => {
    const r = compareTexts('a'.repeat(MAX_DIFF_BYTES + 1), 'a', text());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/izquierdo.*máximo/);
  });

  it('resuelve entradas medianas sin bloquearse', () => {
    const l = Array.from({ length: 3000 }, (_, i) => `línea ${i}`).join('\n');
    const r = l.replace('línea 1500', 'cambio 1500');
    const t0 = Date.now();
    const res = run(l, r);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(res.stats.modified).toBe(1);
  });
});

describe('withContext y toPlainDiff', () => {
  const rows = run(
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'].join('\n'),
    ['1', '2', '3', '4', 'X', '6', '7', '8', '9', '10'].join('\n'),
  ).rows;

  it('conserva el contexto y resume el resto', () => {
    const cut = withContext(rows, 1);
    expect(types(cut)).toEqual(['skip', 'equal', 'removed', 'added', 'equal', 'skip']);
    expect(cut[0]).toEqual({ type: 'skip', count: 3 });
    expect(cut[5]).toEqual({ type: 'skip', count: 4 });
  });

  it('no oculta nada si todo está cerca de un cambio', () => {
    expect(withContext(rows, 50)).toEqual(rows);
  });

  it('genera un diff en texto plano', () => {
    const plain = toPlainDiff(run('a\nb', 'a\nc').rows);
    expect(plain.split('\n').filter((l) => l.startsWith('- ') || l.startsWith('+ '))).toHaveLength(2);
    expect(plain).toContain('  a');
  });
});
