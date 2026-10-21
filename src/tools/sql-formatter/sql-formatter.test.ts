import { describe, expect, it } from 'vitest';
import { DEFAULT_SQL_OPTIONS, MAX_SQL_BYTES, formatSql, type SqlOptions } from './sql-formatter';
import { SQL_EXAMPLES } from './sql-examples';

const fmt = (sql: string, o: Partial<SqlOptions> = {}) => {
  const r = formatSql(sql, { ...DEFAULT_SQL_OPTIONS, ...o });
  if (!r.ok) throw new Error(r.error.message);
  return r.output;
};

describe('MySQL', () => {
  it('pone cada cláusula en su línea con sangría', () => {
    expect(fmt('select a, b from t where x = 1 and y = 2 order by a')).toBe(
      'select\n  a,\n  b\nfrom\n  t\nwhere\n  x = 1\n  and y = 2\norder by\n  a',
    );
  });

  it('conserva los identificadores con acentos graves y las cadenas', () => {
    const out = fmt("select `u`.`id` from `users` u where u.name = 'O''Brien' and s = \"on\"");
    expect(out).toContain('`u`.`id`');
    expect(out).toContain("'O''Brien'");
    expect(out).toContain('"on"');
  });

  it('entiende LIMIT con offset y ON DUPLICATE KEY UPDATE', () => {
    expect(fmt('select * from t limit 10, 5')).toMatch(/limit\n {2}10, 5$/);
    expect(fmt('insert into t (a,b) values (1,2) on duplicate key update b = values(b)')).toContain('on duplicate key update');
  });

  it('conserva los comentarios', () => {
    const out = fmt("select 'ok' /* nota */, 1 -- fin\nfrom dual");
    expect(out).toContain('/* nota */');
    expect(out).toContain('-- fin');
  });
});

describe('Transact-SQL (SQL Server)', () => {
  const t = (sql: string, o: Partial<SqlOptions> = {}) => fmt(sql, { dialect: 'transactsql', ...o });

  it('conserva corchetes, TOP, parámetros y cadenas N', () => {
    const out = t("select top 10 [u].[id] from [dbo].[users] u where u.age > @min and name like N'%a'");
    expect(out).toContain('top 10');
    expect(out).toContain('[u].[id]');
    expect(out).toContain('[dbo].[users]');
    expect(out).toContain('@min');
    expect(out).toContain("N'%a'");
  });

  it('separa lotes con GO', () => {
    const out = t('select * from a; go select 1');
    expect(out).toMatch(/go\n/);
  });

  it('formatea una expresión de tabla común (CTE)', () => {
    const out = t('with r as (select top 5 id from [dbo].[o]) select * from r');
    expect(out).toContain('r as (\n    select\n      top 5 id');
    expect(out).toMatch(/\n {2}\)\nselect\n {2}\*/);
  });

  it('trata #tabla temporal distinto que MySQL', () => {
    const sql = 'select * from #tmp where a = 1';
    expect(t(sql)).toContain('#tmp');
    // En MySQL «#» inicia un comentario, así que el resto de la línea se conserva como comentario.
    expect(fmt(sql)).toContain('#tmp where a = 1');
  });
});

describe('opciones', () => {
  const q = 'SELECT a FROM t WHERE b = 1';

  it('keywordCase', () => {
    expect(fmt('select a from t', { keywordCase: 'upper' })).toBe('SELECT\n  a\nFROM\n  t');
    expect(fmt(q, { keywordCase: 'lower' })).toBe('select\n  a\nfrom\n  t\nwhere\n  b = 1');
    expect(fmt('Select a From t', { keywordCase: 'preserve' })).toContain('Select');
  });

  it('indentación de 2, 4 espacios y tabulador', () => {
    expect(fmt(q, { indent: 2 })).toContain('\n  a');
    expect(fmt(q, { indent: 4 })).toContain('\n    a');
    expect(fmt(q, { indent: 'tab' })).toContain('\n\ta');
  });

  it('es idempotente: formatear un resultado ya formateado no cambia nada', () => {
    for (const ex of SQL_EXAMPLES.filter((e) => !e.label.includes('error'))) {
      const once = fmt(ex.sql, { dialect: ex.dialect });
      expect(fmt(once, { dialect: ex.dialect })).toBe(once);
    }
  });
});

describe('errores y límites (sin lanzar excepciones)', () => {
  it.each(['', '   ', '\n\t'])('entrada vacía %j', (v) => {
    const r = formatSql(v);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/Escribe o pega/);
  });

  it('cadena sin cerrar: mensaje comprensible con línea y columna', () => {
    const r = formatSql("select 1\nfrom t where x = 'abc", DEFAULT_SQL_OPTIONS);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.line).toBe(2);
      expect(r.error.column).toBeGreaterThan(0);
      expect(r.error.message).toMatch(/comillas/);
      expect(r.error.message).not.toMatch(/Parse error|SQL dialect used/);
    }
  });

  it('corchete sin cerrar en SQL Server', () => {
    const r = formatSql('select [a from t', { ...DEFAULT_SQL_OPTIONS, dialect: 'transactsql' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/corchetes/);
  });

  it('no lanza con texto que no es SQL', () => {
    for (const junk of ['@@@@', '((((', ')))', '\u0000\u0001', 'hola mundo, esto no es sql']) {
      expect(() => formatSql(junk)).not.toThrow();
    }
  });

  it('rechaza entradas por encima del límite', () => {
    const r = formatSql('select ' + 'a'.repeat(MAX_SQL_BYTES), DEFAULT_SQL_OPTIONS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/máximo/);
  });

  it('formatea una consulta larga en tiempo razonable', () => {
    const cols = Array.from({ length: 2000 }, (_, i) => `col${i}`).join(', ');
    const t0 = Date.now();
    const r = formatSql(`select ${cols} from t`, DEFAULT_SQL_OPTIONS);
    expect(r.ok).toBe(true);
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  it('los ejemplos válidos se formatean y el de error falla', () => {
    for (const ex of SQL_EXAMPLES) {
      const r = formatSql(ex.sql, { ...DEFAULT_SQL_OPTIONS, dialect: ex.dialect });
      expect(r.ok).toBe(!ex.label.includes('error'));
    }
  });
});
