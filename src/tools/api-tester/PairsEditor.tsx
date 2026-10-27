import { button, field, muted } from '../../components/ui';
import type { Pair } from './api-tester';

/** Fila con identificador estable para las claves de React. */
export interface Row extends Pair {
  id: number;
}

let nextId = 0;
export const newRow = (): Row => ({ key: '', value: '', enabled: true, id: nextId++ });
export const toRows = (pairs: Pair[]): Row[] => pairs.map((p) => ({ ...p, id: nextId++ }));

interface Props {
  rows: Row[];
  onChange: (rows: Row[]) => void;
  /** Nombre en singular de cada fila, para las etiquetas accesibles: «parámetro», «cabecera»… */
  noun: string;
  keyPlaceholder: string;
  valuePlaceholder: string;
  empty: string;
}

/** Tabla editable de pares clave-valor que se pueden activar o desactivar sin borrarlos. */
export default function PairsEditor({ rows, onChange, noun, keyPlaceholder, valuePlaceholder, empty }: Props) {
  const update = (id: number, patch: Partial<Pair>) => onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  return (
    <div className="space-y-2">
      {rows.length === 0 && <p className={`text-sm ${muted}`}>{empty}</p>}
      {rows.map((r, i) => (
        <div key={r.id} className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={r.enabled}
            onChange={(e) => update(r.id, { enabled: e.target.checked })}
            aria-label={`Activar ${noun} ${i + 1}`}
            className="size-4 shrink-0 accent-indigo-600"
          />
          <input
            type="text"
            value={r.key}
            onChange={(e) => update(r.id, { key: e.target.value })}
            placeholder={keyPlaceholder}
            aria-label={`Nombre de ${noun} ${i + 1}`}
            spellCheck={false}
            autoComplete="off"
            className={`min-w-0 flex-1 font-mono ${field}`}
          />
          <input
            type="text"
            value={r.value}
            onChange={(e) => update(r.id, { value: e.target.value })}
            placeholder={valuePlaceholder}
            aria-label={`Valor de ${noun} ${i + 1}`}
            spellCheck={false}
            autoComplete="off"
            className={`min-w-0 flex-[2] font-mono ${field}`}
          />
          <button type="button" className={button} onClick={() => onChange(rows.filter((x) => x.id !== r.id))} aria-label={`Quitar ${noun} ${i + 1}`}>
            ✕
          </button>
        </div>
      ))}
      <button type="button" className={button} onClick={() => onChange([...rows, newRow()])}>
        Añadir {noun}
      </button>
    </div>
  );
}
