import { useId, useState, type SyntheticEvent } from 'react';

/** Ancho máximo del tooltip (max-w-64) más un margen, para decidir hacia qué lado se abre. */
const TOOLTIP_SPACE = 256 + 16;

/**
 * Icono «?» con una ayuda flotante que aparece al pasar el ratón, al enfocarlo o al tocarlo, sin desplazar el diseño.
 * Va junto a la etiqueta, fuera del <label>, para que pulsarlo no active el campo. Escape lo cierra.
 */
export default function Tooltip({ text }: { text: string }) {
  const id = useId();
  const [alignRight, setAlignRight] = useState(false);

  // Si no cabe hacia la derecha (por ejemplo, en el último campo de una fila), se abre hacia la izquierda.
  function place(e: SyntheticEvent<HTMLElement>) {
    const { left } = e.currentTarget.getBoundingClientRect();
    setAlignRight(left + TOOLTIP_SPACE > document.documentElement.clientWidth);
  }

  return (
    <span className="group relative ml-1 inline-flex align-middle" onPointerEnter={place} onFocus={place}>
      <button
        type="button"
        aria-label="Ayuda"
        aria-describedby={id}
        onKeyDown={(e) => e.key === 'Escape' && e.currentTarget.blur()}
        className="inline-flex size-4 cursor-help items-center justify-center rounded-full border border-slate-400 text-[10px] leading-none font-bold text-slate-600 hover:border-indigo-500 hover:text-indigo-600 dark:border-slate-500 dark:text-slate-300 dark:hover:text-indigo-400"
      >
        ?
      </button>
      <span
        id={id}
        role="tooltip"
        className={`pointer-events-none invisible absolute bottom-full z-10 mb-2 w-max max-w-64 rounded-md bg-slate-900 px-3 py-2 text-xs font-normal text-white opacity-0 shadow-lg transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100 dark:bg-slate-700 ${
          alignRight ? 'right-0' : 'left-0'
        }`}
      >
        {text}
      </span>
    </span>
  );
}
