export interface Tool {
  slug: string;
  name: string;
  description: string;
  category: string;
  /** false mientras la página de la herramienta aún no existe. */
  available: boolean;
  /** Slugs de herramientas relacionadas, para los enlaces internos de cada página. */
  related: string[];
}

// Registro central de herramientas. Al añadir una, la home y el buscador la recogen solos.
export const tools: Tool[] = [
  {
    slug: 'json-formatter',
    name: 'JSON Formatter y Validador',
    description: 'Formatea, valida y minifica JSON directamente en tu navegador.',
    category: 'Datos',
    available: true,
    related: ['text-diff', 'sql-formatter'],
  },
  {
    slug: 'text-diff',
    name: 'Comparador de texto y JSON',
    description: 'Compara dos textos o documentos JSON y resalta las diferencias.',
    category: 'Texto',
    available: true,
    related: ['json-formatter', 'timestamp-converter'],
  },
  {
    slug: 'sql-formatter',
    name: 'SQL Formatter',
    description: 'Da formato y sangría a consultas SQL para MySQL y SQL Server.',
    category: 'Datos',
    available: true,
    related: ['json-formatter', 'text-diff'],
  },
  {
    slug: 'timestamp-converter',
    name: 'Convertidor de Unix Timestamp',
    description: 'Convierte timestamps Unix a fechas legibles y viceversa.',
    category: 'Tiempo',
    available: true,
    related: ['json-formatter', 'text-diff'],
  },
];

export const relatedTools = (slug: string): Tool[] => {
  const tool = tools.find((t) => t.slug === slug);
  return (tool?.related ?? []).map((r) => tools.find((t) => t.slug === r)).filter((t): t is Tool => t !== undefined);
};

export const toolUrl = (tool: Tool): string => `/tools/${tool.slug}/`;
