import { format } from 'sql-formatter';
import { byteLength, formatBytes } from '../../lib/validation';

export type Dialect = 'mysql' | 'transactsql';
export type KeywordCase = 'preserve' | 'upper' | 'lower';
export type SqlIndent = 2 | 4 | 'tab';

export interface SqlOptions {
  dialect: Dialect;
  indent: SqlIndent;
  keywordCase: KeywordCase;
}

export const DEFAULT_SQL_OPTIONS: SqlOptions = { dialect: 'mysql', indent: 2, keywordCase: 'preserve' };

export const DIALECT_LABELS: Record<Dialect, string> = {
  mysql: 'MySQL',
  transactsql: 'Transact-SQL (SQL Server)',
};

/** El formateo es lineal en la práctica, pero se acota para no bloquear la pestaña. */
export const MAX_SQL_BYTES = 512 * 1024;

export interface SqlError {
  message: string;
  line?: number;
  column?: number;
}

export type SqlResult = { ok: true; output: string } | { ok: false; error: SqlError };

/** Traduce el error del tokenizador (en inglés, con detalles internos) a un mensaje comprensible. */
function describeError(raw: string): SqlError {
  const where = /line (\d+) column (\d+)/i.exec(raw);
  const token = /Unexpected "([^"]*)"/.exec(raw)?.[1];
  const shown = token && token.length > 30 ? `${token.slice(0, 30)}…` : token;
  const hint = shown?.startsWith("'") || shown?.startsWith('"') || shown?.startsWith('`')
    ? ' Parece un texto entre comillas que no se cierra.'
    : shown?.startsWith('[')
      ? ' Parece un identificador entre corchetes que no se cierra.'
      : '';
  return {
    message: `No se reconoce un fragmento de la consulta${shown ? `: «${shown}»` : ''}.${hint} Revisa las comillas y los símbolos.`,
    ...(where ? { line: Number(where[1]), column: Number(where[2]) } : {}),
  };
}

export function formatSql(input: string, options: SqlOptions = DEFAULT_SQL_OPTIONS): SqlResult {
  if (input.trim() === '') return { ok: false, error: { message: 'Escribe o pega una consulta SQL para continuar.' } };
  const size = byteLength(input);
  if (size > MAX_SQL_BYTES) {
    return { ok: false, error: { message: `El texto pesa ${formatBytes(size)} y el máximo es ${formatBytes(MAX_SQL_BYTES)}.` } };
  }
  try {
    const output = format(input, {
      language: options.dialect,
      useTabs: options.indent === 'tab',
      tabWidth: options.indent === 'tab' ? 2 : options.indent,
      keywordCase: options.keywordCase,
    });
    return { ok: true, output };
  } catch (e) {
    return { ok: false, error: describeError(e instanceof Error ? e.message : '') };
  }
}
