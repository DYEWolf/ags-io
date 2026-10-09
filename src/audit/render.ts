// Renderizado con Chromium (Playwright) para comparar contra el HTML sin JavaScript (R-030).
// Todo el tráfico del navegador se intercepta y se hace con `rawRequest` (src/audit/http.ts),
// así que Chromium nunca abre conexiones propias: misma protección SSRF que el resto del auditor.
import { chromium, type Browser, type BrowserContext, type Route } from 'playwright-core'
import { AUDIT_USER_AGENT, BlockedHostError, describeFetchError, rawRequest } from '~/audit/http'

/** Páginas renderizadas como máximo por auditoría (la RAM de la VPS es compartida, R-070). */
export const MAX_RENDERED = 100
const NAVIGATION_TIMEOUT_MS = 30_000
/** Espera extra a que la red quede en reposo tras el DOMContentLoaded. */
const SETTLE_TIMEOUT_MS = 5_000
const REQUEST_TIMEOUT_MS = 20_000
const SUBRESOURCE_MAX_BYTES = 10 * 1024 * 1024
/** No aportan texto ni estructura: no se descargan. */
const BLOCKED_TYPES = new Set(['image', 'media', 'font'])
const DROP_REQUEST_HEADERS = new Set(['host', 'connection', 'content-length', 'accept-encoding'])
const DROP_RESPONSE_HEADERS = new Set([
  'content-length',
  'content-encoding',
  'transfer-encoding',
  'connection',
  'keep-alive',
])

export interface RenderResult {
  status: number | null
  finalUrl: string
  html: string
}

function pick(headers: Record<string, string>, drop: Set<string>) {
  return Object.fromEntries(
    Object.entries(headers).filter(([key]) => !drop.has(key) && !key.startsWith(':')),
  )
}

export class Renderer {
  private constructor(
    private readonly browser: Browser,
    private readonly context: BrowserContext,
    private readonly signal: AbortSignal,
  ) {}

  /** Lanza Chromium (headless shell) con un contexto aislado para una auditoría. */
  static async launch(signal: AbortSignal): Promise<Renderer> {
    const browser = await chromium.launch({
      headless: true,
      args: ['--disable-dev-shm-usage', '--disable-gpu', '--disable-extensions'],
    })
    try {
      const context = await browser.newContext({
        userAgent: AUDIT_USER_AGENT,
        locale: 'es-MX',
        serviceWorkers: 'block',
        acceptDownloads: false,
        javaScriptEnabled: true,
        viewport: { width: 1280, height: 900 },
      })
      const renderer = new Renderer(browser, context, signal)
      await context.route('**/*', (route) => renderer.proxy(route))
      await context.routeWebSocket(
        () => true,
        (ws) => ws.close(),
      )
      return renderer
    } catch (error) {
      await browser.close()
      throw error
    }
  }

  private async proxy(route: Route): Promise<void> {
    const request = route.request()
    if (BLOCKED_TYPES.has(request.resourceType())) {
      await route.abort('blockedbyclient')
      return
    }
    let url: URL
    try {
      url = new URL(request.url())
    } catch {
      await route.abort('addressunreachable')
      return
    }
    try {
      const response = await rawRequest(url, {
        method: request.method(),
        headers: pick(await request.allHeaders(), DROP_REQUEST_HEADERS),
        body: request.postDataBuffer(),
        maxBytes: SUBRESOURCE_MAX_BYTES,
        signal: AbortSignal.any([this.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
      })
      if (response.truncated) {
        await route.abort('failed')
        return
      }
      await route.fulfill({
        status: response.status,
        headers: pick(response.headers, DROP_RESPONSE_HEADERS),
        body: response.body,
      })
    } catch (error) {
      await route
        .abort(error instanceof BlockedHostError ? 'blockedbyclient' : 'failed')
        .catch(() => undefined)
    }
  }

  /** Abre la URL, espera a que se asiente y devuelve el DOM resultante serializado. */
  async render(url: string): Promise<RenderResult> {
    this.signal.throwIfAborted()
    const page = await this.context.newPage()
    try {
      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: NAVIGATION_TIMEOUT_MS,
      })
      await page
        .waitForLoadState('networkidle', { timeout: SETTLE_TIMEOUT_MS })
        .catch(() => undefined)
      return {
        status: response?.status() ?? null,
        finalUrl: page.url(),
        html: await page.content(),
      }
    } finally {
      await page.close().catch(() => undefined)
    }
  }

  /** Falso si el navegador murió o la auditoría se canceló: el error no es de la página. */
  get usable(): boolean {
    return this.browser.isConnected() && !this.signal.aborted
  }

  async close(): Promise<void> {
    await this.context.close().catch(() => undefined)
    await this.browser.close().catch(() => undefined)
  }
}

export function describeRenderError(error: unknown): string {
  if (error instanceof Error && error.name === 'TimeoutError') return 'tiempo de carga agotado'
  return describeFetchError(error)
}
