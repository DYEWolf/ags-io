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

  // --- Renderizado con JavaScript (R-030) ---
  js_dependent_content: {
    severity: 'error',
    category: 'render',
    title: 'El contenido principal solo aparece con JavaScript',
    fix: 'Sirve el contenido en el HTML inicial (SSR o generación estática): la mayoría de los bots de IA no ejecutan JavaScript.',
  },
  js_added_content: {
    severity: 'warning',
    category: 'render',
    title: 'Parte del contenido solo aparece con JavaScript',
    fix: 'Incluye ese texto en el HTML inicial para que lo lean buscadores y bots de IA.',
  },
  js_changed_head: {
    severity: 'warning',
    category: 'render',
    title: 'JavaScript cambia el título, la descripción, la canonical o los robots',
    fix: 'Pon los valores definitivos en el HTML inicial: los bots que no ejecutan JS ven otros.',
  },
  js_only_h1: {
    severity: 'warning',
    category: 'render',
    title: 'El <h1> solo aparece con JavaScript',
    fix: 'Incluye el <h1> en el HTML inicial.',
  },
  render_failed: {
    severity: 'notice',
    category: 'render',
    title: 'No se pudo renderizar la página con JavaScript',
    fix: 'La página tardó demasiado o falló al cargar en el navegador; revisa errores de JavaScript.',
  },
  render_limit: {
    severity: 'notice',
    category: 'render',
    title: 'Se alcanzó el límite de páginas renderizadas',
    fix: 'Solo se compararon con JavaScript las primeras páginas del sitio.',
  },

  // --- Datos estructurados (R-031) ---
  jsonld_invalid: {
    severity: 'error',
    category: 'structured',
    title: 'Bloque JSON-LD con JSON inválido',
    fix: 'Corrige la sintaxis: un bloque inválido se ignora por completo.',
  },
  jsonld_context: {
    severity: 'warning',
    category: 'structured',
    title: 'JSON-LD sin @context de schema.org',
    fix: 'Añade "@context": "https://schema.org" al bloque.',
  },
  jsonld_unknown_type: {
    severity: 'error',
    category: 'structured',
    title: 'Tipo que no existe en schema.org',
    fix: 'Usa un tipo de schema.org (revisa mayúsculas y ortografía).',
  },
  jsonld_unknown_property: {
    severity: 'warning',
    category: 'structured',
    title: 'Propiedad que no existe en schema.org',
    fix: 'Usa una propiedad de schema.org (revisa mayúsculas y ortografía).',
  },
  jsonld_property_mismatch: {
    severity: 'warning',
    category: 'structured',
    title: 'Propiedad que no corresponde a su tipo',
    fix: 'Mueve la propiedad al tipo correcto o cambia el tipo del nodo.',
  },
  jsonld_missing_required: {
    severity: 'error',
    category: 'structured',
    title: 'Faltan propiedades obligatorias para resultados enriquecidos',
    fix: 'Añade las propiedades que Google exige para ese tipo.',
  },
  jsonld_deprecated: {
    severity: 'notice',
    category: 'structured',
    title: 'Término de schema.org reemplazado',
    fix: 'Usa el término que lo sustituye.',
  },
  jsonld_missing: {
    severity: 'warning',
    category: 'structured',
    title: 'La portada no tiene datos estructurados',
    fix: 'Publica JSON-LD en la portada (Organization o LocalBusiness y WebSite).',
  },
  jsonld_js_only: {
    severity: 'warning',
    category: 'structured',
    title: 'El JSON-LD solo aparece con JavaScript',
    fix: 'Inclúyelo en el HTML inicial: los bots de IA no ejecutan JavaScript.',
  },
  localbusiness_missing: {
    severity: 'warning',
    category: 'structured',
    title: 'No hay JSON-LD LocalBusiness',
    fix: 'Publica un LocalBusiness (o su subtipo) con el nombre, la dirección y el teléfono del negocio.',
  },
  nap_mismatch: {
    severity: 'warning',
    category: 'structured',
    title: 'Nombre, dirección o teléfono distintos a los del negocio',
    fix: 'Haz que el JSON-LD coincida con los datos del negocio registrados en el sitio (y con Google Business Profile).',
  },

  // --- Rastreo y robots (R-032) ---
  robots_unreachable: {
    severity: 'error',
    category: 'robots',
    title: 'robots.txt responde con error o no se pudo descargar',
    fix: 'Con un 5xx o sin respuesta, los buscadores asumen que todo está bloqueado. Sirve robots.txt con 200 (o 404 si no lo usas).',
  },
  robots_missing: {
    severity: 'notice',
    category: 'robots',
    title: 'No hay robots.txt',
    fix: 'No es obligatorio, pero sirve para declarar el sitemap y la política por bot.',
  },
  robots_blocks_search: {
    severity: 'error',
    category: 'robots',
    title: 'robots.txt bloquea a un buscador en una ruta clave',
    fix: 'Quita la regla Disallow que afecta a Googlebot/Bingbot/Applebot en esa ruta.',
  },
  robots_blocks_ai_search: {
    severity: 'warning',
    category: 'robots',
    title: 'robots.txt bloquea a un buscador de IA en una ruta clave',
    fix: 'Sin acceso, ChatGPT, Claude o Perplexity no pueden citar el sitio en sus respuestas.',
  },
  robots_blocks_ai_user: {
    severity: 'warning',
    category: 'robots',
    title: 'robots.txt bloquea a los asistentes cuando un usuario pide la página',
    fix: 'ChatGPT-User, Claude-User y Perplexity-User visitan la página a petición de una persona.',
  },
  robots_blocks_ai_training: {
    severity: 'notice',
    category: 'robots',
    title: 'robots.txt bloquea a bots de entrenamiento de IA',
    fix: 'Es una decisión válida: no afecta a buscadores ni a las citas en asistentes.',
  },
  sitemap_blocked_url: {
    severity: 'warning',
    category: 'crawl',
    title: 'URL del sitemap bloqueada por robots.txt',
    fix: 'El sitemap solo debe listar URLs que Googlebot pueda rastrear.',
  },
  sitemap_redirect: {
    severity: 'warning',
    category: 'crawl',
    title: 'URL del sitemap que redirige',
    fix: 'Lista en el sitemap la URL final, no la que redirige.',
  },
  sitemap_lastmod: {
    severity: 'notice',
    category: 'crawl',
    title: 'URLs del sitemap sin lastmod válido',
    fix: 'Incluye <lastmod> con la fecha real de modificación en formato W3C (AAAA-MM-DD).',
  },
  broken_link: {
    severity: 'error',
    category: 'crawl',
    title: 'Enlace interno roto',
    fix: 'Corrige o quita el enlace: responde con error o no carga.',
  },
  link_limit: {
    severity: 'notice',
    category: 'crawl',
    title: 'Se alcanzó el límite de enlaces revisados',
    fix: 'Solo se comprobaron los primeros enlaces internos que no están en el sitemap.',
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
