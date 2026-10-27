import type { KeyboardEvent, ReactNode } from 'react';

interface Props<T extends string> {
  label: string;
  /** Prefijo único para los id de pestañas y paneles. */
  idBase: string;
  tabs: { id: T; label: string }[];
  selected: T;
  onSelect: (id: T) => void;
  children: ReactNode;
}

/** Pestañas accesibles: se cambian con clic o con las flechas izquierda y derecha. */
export default function Tabs<T extends string>({ label, idBase, tabs, selected, onSelect, children }: Props<T>) {
  const tabId = (id: T) => `${idBase}-tab-${id}`;
  const panelId = (id: T) => `${idBase}-panel-${id}`;

  function onKeyDown(e: KeyboardEvent, index: number) {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = tabs[(index + step + tabs.length) % tabs.length];
    onSelect(next.id);
    document.getElementById(tabId(next.id))?.focus();
  }

  return (
    <div>
      <div role="tablist" aria-label={label} className="flex flex-wrap gap-1 border-b border-slate-200 dark:border-slate-800">
        {tabs.map((t, i) => {
          const active = t.id === selected;
          return (
            <button
              key={t.id}
              id={tabId(t.id)}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={panelId(t.id)}
              tabIndex={active ? 0 : -1}
              onClick={() => onSelect(t.id)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
                active
                  ? 'border-indigo-600 text-indigo-700 dark:border-indigo-400 dark:text-indigo-400'
                  : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={panelId(selected)} aria-labelledby={tabId(selected)} className="pt-4">
        {children}
      </div>
    </div>
  );
}
