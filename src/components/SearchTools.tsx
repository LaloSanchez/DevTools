import { useId, useMemo, useState } from 'react';
import type { Tool } from '../content/tools';

interface Props {
  tools: Tool[];
}

const normalize = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export default function SearchTools({ tools }: Props) {
  const [query, setQuery] = useState('');
  const inputId = useId();

  const results = useMemo(() => {
    const q = normalize(query.trim());
    if (!q) return tools;
    return tools.filter((t) =>
      normalize(`${t.name} ${t.description} ${t.category}`).includes(q),
    );
  }, [query, tools]);

  return (
    <div>
      <label htmlFor={inputId} className="block text-sm font-medium">
        Buscar herramienta
      </label>
      <input
        id={inputId}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Ej: JSON, SQL, fecha…"
        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
      />
      <p className="sr-only" role="status" aria-live="polite">
        {results.length} {results.length === 1 ? 'resultado' : 'resultados'}
      </p>
      {results.length === 0 ? (
        <p className="mt-4 text-slate-600 dark:text-slate-400">
          No encontramos herramientas para “{query}”. Prueba con otra palabra.
        </p>
      ) : (
        <>
          <h2 className="sr-only">Herramientas disponibles</h2>
        <ul className="mt-4 grid gap-4 sm:grid-cols-2">
          {results.map((t) => (
            <li key={t.slug}>
              {t.available ? (
                <a
                  href={`/tools/${t.slug}/`}
                  className="block h-full rounded-lg border border-slate-200 p-4 transition-colors hover:border-indigo-500 dark:border-slate-800"
                >
                  <p className="text-xs font-medium uppercase tracking-wide text-indigo-600 dark:text-indigo-400">{t.category}</p>
                  <h3 className="mt-1 font-semibold">{t.name}</h3>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{t.description}</p>
                </a>
              ) : (
                <div className="h-full rounded-lg border border-dashed border-slate-200 p-4 dark:border-slate-800">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400">{t.category} · Próximamente</p>
                  <h3 className="mt-1 font-semibold">{t.name}</h3>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{t.description}</p>
                </div>
              )}
            </li>
          ))}
        </ul>
        </>
      )}
    </div>
  );
}
