// Catálogo de reglas de la auditoría técnica (R-030–R-034). Lógica pura.

export const SEVERITIES = ['error', 'warning', 'notice'] as const
export type Severity = (typeof SEVERITIES)[number]

export const RULE_CATEGORIES = [
  'crawl',
  'onpage',
  'render',
  'structured',
  'robots',
  'speed',
] as const
export type RuleCategory = (typeof RULE_CATEGORIES)[number]

export interface RuleInfo {
  severity: Severity
  category: RuleCategory
  /** Qué está mal, en una línea. */
  title: string
  /** Cómo corregirlo. */
  fix: string
}

/**
 * Reglas conocidas. El `id` se guarda en `audit_findings.rule`: renombrar uno rompe el diff
 * contra auditorías anteriores, así que solo se añaden.
 */
export const RULES = {
  // --- Rastreo (R-030, R-032) ---
  fetch_failed: {
    severity: 'error',
    category: 'crawl',
    title: 'No se pudo descargar la página',
    fix: 'Revisa que el servidor responda y que la URL exista.',
  },
  http_error: {
    severity: 'error',
    category: 'crawl',
    title: 'La página responde con error (4xx/5xx)',
    fix: 'Corrige la página o quítala del sitemap.',
  },
  not_html: {
    severity: 'notice',
    category: 'crawl',
    title: 'La URL no es una página HTML',
    fix: 'El sitemap debería listar páginas HTML; los archivos (PDF, imágenes) no se auditan.',
  },
  page_too_large: {
    severity: 'warning',
    category: 'crawl',
    title: 'El HTML es demasiado grande',
    fix: 'Reduce el HTML: se auditó solo el principio de la página.',
  },
  sitemap_missing: {
    severity: 'error',
    category: 'crawl',
    title: 'No se encontró sitemap',
    fix: 'Publica /sitemap.xml y decláralo en robots.txt con `Sitemap:`.',
  },
  sitemap_invalid: {
    severity: 'error',
    category: 'crawl',
    title: 'Sitemap inaccesible o mal formado',
    fix: 'El sitemap debe responder 200 con XML válido según sitemaps.org.',
  },
  sitemap_foreign_url: {
    severity: 'warning',
    category: 'crawl',
    title: 'El sitemap lista URLs de otro dominio',
    fix: 'Un sitemap solo debe listar URLs de su propio dominio.',
  },
  crawl_limit: {
    severity: 'notice',
    category: 'crawl',
    title: 'Se alcanzó el límite de páginas por auditoría',
    fix: 'Solo se auditaron las primeras URLs del sitemap.',
  },

  // --- On-page sin JavaScript (R-030) ---
  title_missing: {
    severity: 'error',
    category: 'onpage',
    title: 'Falta el <title>',
    fix: 'Añade un título único y descriptivo de 15–60 caracteres.',
  },
  title_length: {
    severity: 'notice',
    category: 'onpage',
    title: 'Título demasiado corto o largo',
    fix: 'Usa entre 15 y 60 caracteres para que no se corte en los resultados.',
  },
  title_duplicate: {
    severity: 'warning',
    category: 'onpage',
    title: 'Título repetido en varias páginas',
    fix: 'Cada página debe tener un título propio.',
  },
  description_missing: {
    severity: 'warning',
    category: 'onpage',
    title: 'Falta la meta description',
    fix: 'Añade una descripción de 50–160 caracteres que resuma la página.',
  },
  description_length: {
    severity: 'notice',
    category: 'onpage',
    title: 'Meta description demasiado corta o larga',
    fix: 'Usa entre 50 y 160 caracteres.',
  },
  description_duplicate: {
    severity: 'warning',
    category: 'onpage',
    title: 'Meta description repetida en varias páginas',
    fix: 'Cada página debe tener una descripción propia.',
  },
  h1_missing: {
    severity: 'error',
    category: 'onpage',
    title: 'Falta el <h1>',
    fix: 'Cada página debe tener un único <h1> visible en el HTML inicial.',
  },
  h1_multiple: {
    severity: 'warning',
    category: 'onpage',
    title: 'Hay más de un <h1>',
    fix: 'Deja un solo <h1> y usa <h2>…<h6> para las secciones.',
  },
  canonical_missing: {
    severity: 'warning',
    category: 'onpage',
    title: 'Falta la URL canónica',
    fix: 'Añade <link rel="canonical"> apuntando a la URL preferida de la página.',
  },
  canonical_multiple: {
    severity: 'error',
    category: 'onpage',
    title: 'Hay varias URLs canónicas',
    fix: 'Deja una sola etiqueta canonical; con varias, los buscadores las ignoran.',
  },
  canonical_invalid: {
    severity: 'error',
    category: 'onpage',
    title: 'La URL canónica no es válida',
    fix: 'La canonical debe ser una URL http(s) absoluta y válida.',
  },
  canonical_mismatch: {
    severity: 'warning',
    category: 'onpage',
    title: 'La página declara otra URL como canónica',
    fix: 'Lista en el sitemap solo URLs canónicas, o corrige la canonical.',
  },
  noindex: {
    severity: 'error',
    category: 'onpage',
    title: 'Página del sitemap marcada como noindex',
    fix: 'Quita el noindex (meta robots o X-Robots-Tag) o saca la página del sitemap.',
  },
  thin_content: {
    severity: 'warning',
    category: 'onpage',
    title: 'Poco texto en el HTML inicial',
    fix: 'El contenido principal debe estar en el HTML que entrega el servidor, sin depender de JavaScript.',
  },
} as const satisfies Record<string, RuleInfo>

export type RuleId = keyof typeof RULES

export function isRuleId(value: string): value is RuleId {
  return Object.hasOwn(RULES, value)
}

/** Un hallazgo: regla incumplida en una URL (o en el sitio, si `url` es null). */
export interface Finding {
  rule: RuleId
  url: string | null
  detail?: Record<string, unknown>
}

export const severityOf = (rule: RuleId): Severity => RULES[rule].severity
