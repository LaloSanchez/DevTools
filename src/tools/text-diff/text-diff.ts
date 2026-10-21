import { diffArrays, diffWords, diffWordsWithSpace } from 'diff';
import { formatJson } from '../json-formatter/json-formatter';
import { byteLength, formatBytes } from '../../lib/validation';

/** Límite por lado: la comparación es costosa y se ejecuta en el hilo principal. */
export const MAX_DIFF_BYTES = 1024 * 1024;
const DIFF_TIMEOUT_MS = 3000;
/** Una línea cambiada se muestra como «modificada» solo si conserva al menos esta parte de su contenido. */
const MIN_SIMILARITY = 0.3;

export interface DiffOptions {
  mode: 'text' | 'json';
  ignoreWhitespace: boolean;
  ignoreCase: boolean;
  /** Solo en modo JSON: ignora el orden de las claves de los objetos. */
  sortKeys: boolean;
}

export const DEFAULT_OPTIONS: DiffOptions = { mode: 'text', ignoreWhitespace: false, ignoreCase: false, sortKeys: true };

export interface Segment {
  text: string;
  changed: boolean;
}

export type DiffRow =
  | { type: 'equal'; oldNo: number; newNo: number; text: string }
  | { type: 'added'; newNo: number; text: string }
  | { type: 'removed'; oldNo: number; text: string }
  | { type: 'modified'; oldNo: number; newNo: number; oldSegments: Segment[]; newSegments: Segment[] }
  | { type: 'skip'; count: number };

export interface DiffStats {
  added: number;
  removed: number;
  modified: number;
  equal: number;
}

export type DiffOutcome =
  | { ok: true; rows: DiffRow[]; stats: DiffStats; identical: boolean; warning?: string }
  | { ok: false; error: string };

/** Separa en líneas aceptando CRLF; un salto de línea final cierra la última línea, no añade una vacía. */
export function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split(/\r\n|\r|\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function normalizer(o: Pick<DiffOptions, 'ignoreWhitespace' | 'ignoreCase'>) {
  return (line: string): string => {
    let s = line;
    if (o.ignoreWhitespace) s = s.replace(/\s+/g, ' ').trim();
    if (o.ignoreCase) s = s.toLowerCase();
    return s;
  };
}

function wordSegments(oldLine: string, newLine: string, o: DiffOptions): { old: Segment[]; next: Segment[]; kept: number } {
  const parts = (o.ignoreWhitespace ? diffWords : diffWordsWithSpace)(oldLine, newLine, { ignoreCase: o.ignoreCase });
  const old: Segment[] = [];
  const next: Segment[] = [];
  let kept = 0;
  for (const part of parts) {
    if (part.added) next.push({ text: part.value, changed: true });
    else if (part.removed) old.push({ text: part.value, changed: true });
    else {
      old.push({ text: part.value, changed: false });
      next.push({ text: part.value, changed: false });
      kept += part.value.length;
    }
  }
  return { old, next, kept };
}

function runDiff(oldLines: string[], newLines: string[], o: DiffOptions): DiffOutcome {
  const norm = normalizer(o);
  const changes = diffArrays(oldLines, newLines, {
    comparator: (a: string, b: string) => norm(a) === norm(b),
    timeout: DIFF_TIMEOUT_MS,
  });
  if (!changes) {
    return { ok: false, error: 'Los textos son demasiado distintos o extensos para compararlos. Prueba con fragmentos más pequeños.' };
  }

  const rows: DiffRow[] = [];
  const stats: DiffStats = { added: 0, removed: 0, modified: 0, equal: 0 };
  let oldNo = 1; // número de la siguiente línea del original
  let newNo = 1; // número de la siguiente línea del nuevo

  for (let i = 0; i < changes.length; i++) {
    const change = changes[i];
    if (!change.added && !change.removed) {
      for (let k = 0; k < change.count!; k++) {
        rows.push({ type: 'equal', oldNo: oldNo + k, newNo: newNo + k, text: newLines[newNo - 1 + k] });
      }
      stats.equal += change.count!;
      oldNo += change.count!;
      newNo += change.count!;
      continue;
    }

    // jsdiff entrega las eliminaciones antes que las adiciones del mismo bloque.
    const following = changes[i + 1];
    const removed = change.removed ? change.value : [];
    const added = change.removed ? (following?.added ? following.value : []) : change.value;
    if (change.removed && following?.added) i++;

    // Se emparejan por posición; si dos líneas apenas se parecen, se muestran como eliminada + añadida.
    const pairs = Math.min(removed.length, added.length);
    for (let k = 0; k < pairs; k++) {
      const seg = wordSegments(removed[k], added[k], o);
      const similarity = seg.kept / Math.max(removed[k].length, added[k].length, 1);
      if (similarity >= MIN_SIMILARITY) {
        rows.push({ type: 'modified', oldNo: oldNo + k, newNo: newNo + k, oldSegments: seg.old, newSegments: seg.next });
        stats.modified++;
      } else {
        rows.push({ type: 'removed', oldNo: oldNo + k, text: removed[k] });
        rows.push({ type: 'added', newNo: newNo + k, text: added[k] });
        stats.removed++;
        stats.added++;
      }
    }
    for (let k = pairs; k < removed.length; k++) {
      rows.push({ type: 'removed', oldNo: oldNo + k, text: removed[k] });
      stats.removed++;
    }
    for (let k = pairs; k < added.length; k++) {
      rows.push({ type: 'added', newNo: newNo + k, text: added[k] });
      stats.added++;
    }
    oldNo += removed.length;
    newNo += added.length;
  }

  const identical = stats.added === 0 && stats.removed === 0 && stats.modified === 0;
  return { ok: true, rows, stats, identical };
}

function sideError(side: 'izquierdo' | 'derecho', message: string, line?: number, column?: number): string {
  const where = line !== undefined ? ` (cerca de la línea ${line}, columna ${column})` : '';
  return `El JSON del lado ${side} no es válido${where}. ${message}`;
}

export function compareTexts(left: string, right: string, options: DiffOptions = DEFAULT_OPTIONS): DiffOutcome {
  if (left.trim() === '' && right.trim() === '') {
    return { ok: false, error: 'Escribe o pega texto en al menos uno de los dos campos.' };
  }
  for (const [name, text] of [['izquierdo', left], ['derecho', right]] as const) {
    const size = byteLength(text);
    if (size > MAX_DIFF_BYTES) {
      return { ok: false, error: `El texto ${name} pesa ${formatBytes(size)} y el máximo es ${formatBytes(MAX_DIFF_BYTES)}.` };
    }
  }

  let a = left;
  let b = right;
  let warning: string | undefined;
  if (options.mode === 'json') {
    const l = formatJson(left, 2, options.sortKeys);
    if (!l.ok) return { ok: false, error: sideError('izquierdo', l.error.message, l.error.line, l.error.column) };
    const r = formatJson(right, 2, options.sortKeys);
    if (!r.ok) return { ok: false, error: sideError('derecho', r.error.message, r.error.line, r.error.column) };
    a = l.output;
    b = r.output;
    warning = (l.warning ?? r.warning) ? 'Hay números de más de 15 dígitos; JavaScript puede redondearlos y ocultar diferencias.' : undefined;
  }

  const result = runDiff(splitLines(a), splitLines(b), options);
  return result.ok && warning ? { ...result, warning } : result;
}

/** Deja solo las filas cambiadas con `context` líneas iguales alrededor; el resto se resume en una fila `skip`. */
export function withContext(rows: DiffRow[], context = 2): DiffRow[] {
  const keep = new Array<boolean>(rows.length).fill(false);
  rows.forEach((row, i) => {
    if (row.type === 'equal' || row.type === 'skip') return;
    for (let k = Math.max(0, i - context); k <= Math.min(rows.length - 1, i + context); k++) keep[k] = true;
  });
  const out: DiffRow[] = [];
  let hidden = 0;
  rows.forEach((row, i) => {
    if (keep[i]) {
      if (hidden) out.push({ type: 'skip', count: hidden });
      hidden = 0;
      out.push(row);
    } else hidden++;
  });
  if (hidden) out.push({ type: 'skip', count: hidden });
  return out;
}

const join = (segments: Segment[]) => segments.map((s) => s.text).join('');

/** Texto plano estilo «diff»: «- » eliminada, «+ » añadida, «  » sin cambios. */
export function toPlainDiff(rows: DiffRow[]): string {
  const lines: string[] = [];
  for (const row of rows) {
    if (row.type === 'equal') lines.push(`  ${row.text}`);
    else if (row.type === 'added') lines.push(`+ ${row.text}`);
    else if (row.type === 'removed') lines.push(`- ${row.text}`);
    else if (row.type === 'modified') lines.push(`- ${join(row.oldSegments)}`, `+ ${join(row.newSegments)}`);
    else lines.push(`  … ${row.count} líneas iguales …`);
  }
  return lines.join('\n');
}

export const DIFF_EXAMPLES = [
  {
    label: 'Texto con cambios',
    mode: 'text' as const,
    left: 'Hola mundo\nEsta línea no cambia\nColor: rojo\nLínea que se elimina',
    right: 'Hola mundo!\nEsta línea no cambia\nColor: azul\nLínea nueva al final',
  },
  {
    label: 'JSON con otro formato',
    mode: 'json' as const,
    left: '{"nombre":"Ana","edad":30,"roles":["admin","editor"]}',
    right: '{\n  "edad": 31,\n  "nombre": "Ana",\n  "roles": ["admin", "editor"]\n}',
  },
];
