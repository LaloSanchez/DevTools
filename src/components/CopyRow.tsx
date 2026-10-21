import { useEffect, useRef, useState } from 'react';
import { copyText } from '../lib/clipboard';
import { button } from './ui';

interface Props {
  label: string;
  value: string;
}

/** Fila «etiqueta — valor — Copiar» con confirmación accesible. Debe usarse dentro de un <ul>. */
export default function CopyRow({ label, value }: Props) {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle');
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy() {
    setState((await copyText(value)) ? 'ok' : 'fail');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState('idle'), 2000);
  }

  return (
    <li className="flex flex-wrap items-center gap-2 border-b border-slate-200 py-2 last:border-0 dark:border-slate-800">
      <span className="w-44 shrink-0 text-sm font-medium">{label}</span>
      <span className="min-w-0 flex-1 break-all font-mono text-sm">{value}</span>
      <button type="button" className={button} onClick={copy} aria-label={`Copiar ${label}`}>
        {state === 'ok' ? 'Copiado' : state === 'fail' ? 'No se pudo' : 'Copiar'}
      </button>
    </li>
  );
}
