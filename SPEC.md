# ags-io — Especificación (Spec-Driven Development)

> Estado: borrador v0.2 · Fecha: 2026-10-08 · Autor: Christopher
> Este documento es la fuente de verdad del proyecto. Todo cambio de alcance se hace primero aquí y después en código.
>
> **v0.2**: el producto pasa de herramienta de un solo admin a **servicio B2C** (cuentas de clientes, multi-tenencia por organización), se elige Better Auth y Resend, se eliminan los unit tests y el plan se reorganiza en módulos aprobados por e2e manual.

---

## 0. Cómo usar este spec

1. **Requisitos (§3–4)** definen *qué* debe hacer el sistema. Cada requisito tiene un ID (`R-XXX`) y criterios de aceptación en formato EARS (`CUANDO … EL SISTEMA DEBE …`).
2. **Diseño (§5–8)** define *cómo* se construye.
3. **Módulos (§10)** referencian IDs de requisitos. Un módulo es un objetivo alcanzable y probable de punta a punta (p. ej. "Cuentas"); se entrega con **funcionalidad final y robusta, no MVP**.
4. **Flujo por módulo**: se implementa → pasa `pnpm check` → se entrega con un guion de prueba e2e manual → el admin lo prueba → **solo con su aprobación** se marca el módulo y se empieza el siguiente.
5. Si al implementar algo el spec resulta incorrecto, se corrige el spec en el mismo commit/PR.

---

## 1. Contexto y objetivo

Construir un **servicio autohospedado** (`ags-io`) en el que negocios crean su cuenta y, con nuestra ayuda, **crean, auditan y miden** sus sitios optimizados para:

- **SEO**: visibilidad en Google y Bing (orgánico y local/Maps).
- **GEO / AEO**: visibilidad en respuestas de IA y motores de respuesta (ChatGPT, Perplexity, Gemini, Google AI Overviews/AI Mode, Copilot, Claude).

Principio rector: **pagar solo infraestructura** (VPS existente) y, cuando sea inevitable, **créditos por uso** o free tiers. Evitar suscripciones fijas.

### 1.1 Alcance de este repo (`ags-io`)

Este repo contiene **el servicio**: app web (dashboard de clientes + panel de staff) + worker. Los sitios de clientes viven en un **repo separado** (`sites`, ver §9), sin dependencias de código entre ambos. El servicio solo conoce las URLs y propiedades de cada sitio.

### 1.2 Principios

- **SEO técnico primero; GEO es una capa encima**, no un reemplazo.
- **Medir probabilidades, no posiciones** en IA: múltiples corridas por prompt y reporte de frecuencia.
- **Evidencia cruda siempre guardada** (SERP y respuestas de LLM en JSONB) para poder recalcular métricas.
- **Nada de scraping directo** de Google ni de las apps de consumo de ChatGPT, Perplexity, etc. Solo APIs oficiales o proveedores de SERP.
- **Frugalidad de recursos**: la VPS es compartida con producción (Vesti).

---

## 2. Objetivos y no-objetivos

### Objetivos (v1)
- G1. Centralizar datos gratuitos de Search Console y Bing Webmaster Tools por sitio.
- G2. Registrar y verificar visitas de bots de búsqueda e IA desde los logs de Caddy.
- G3. Auditar técnicamente cada sitio (HTML sin JS, JSON-LD, indexabilidad, Core Web Vitals).
- G4. Rastrear posiciones en Google (orgánico + local) con costo mínimo.
- G5. Medir visibilidad en IA: primero con registro manual, luego automatizado.
- G6. Generar reportes mensuales por cliente y alertas.
- G7. Cuentas de cliente self-service: registro, login seguro y datos aislados por organización.

### No-objetivos (v1)
- Índice propio de backlinks o volúmenes de keywords (se compran por uso si hace falta, fase posterior).
- Facturación, planes o billing (módulo futuro; ver backlog §10).
- Invitaciones de miembros a una organización y login con Google (módulos futuros; ver backlog §10).
- Generación automática de contenido con IA.
- Automatizar interfaces de consumo de LLMs con navegador.

---

## 3. Actores y restricciones

**Actores**
- **Staff** (Christopher): opera la plataforma. Ve y gestiona todas las organizaciones, puede suspender cuentas e impersonar usuarios para soporte.
- **Cliente**: crea su cuenta; al registrarse obtiene su propia **organización** (rol *owner*). Solo ve los datos de su organización. Recibe además reportes (PDF/enlace).
- **Sistemas externos**: Google Search Console API, Bing Webmaster API, PageSpeed Insights API, Serper, APIs de LLM, Telegram, Resend (email).

**Restricciones de infraestructura** (VPS Hetzner `web-apps-1`)
- 3 vCPU AMD EPYC, ~3.7 GiB RAM, 80 GB disco, Ubuntu 24.04.
- Comparte servidor con Vesti (Node + Typesense) y Caddy (proxy de todo).
- Presupuesto de RAM para ags-io: **≤ 1.2 GiB en pico** (incluyendo Chromium), ≤ 500 MiB en reposo.
- Builds **fuera** de la VPS (GitHub Actions → GHCR).
- Capacidad: este presupuesto alcanza para pocos clientes. Cuando la carga del worker o el número de organizaciones lo exija, se separa ags-io a su propio servidor (decisión a revisar, no bloquea v1).

---

## 4. Requisitos

### 4.1 Núcleo y administración

**R-001 Cuentas y autenticación**
- EL SISTEMA DEBE permitir registro con email y contraseña. CUANDO un usuario se registra, EL SISTEMA DEBE enviar un correo de verificación y NO DEBE permitir el acceso al dashboard hasta que el email esté verificado.
- CUANDO un usuario no autenticado accede a cualquier ruta privada, EL SISTEMA DEBE redirigirlo al login y, tras autenticarse, devolverlo a la ruta original.
- EL SISTEMA DEBE almacenar contraseñas con hash argon2id y exigir una longitud mínima de 12 caracteres.
- EL SISTEMA DEBE usar sesiones guardadas en DB con cookie `HttpOnly`, `Secure`, `SameSite=Lax`; duración 30 días con renovación por uso.
- EL SISTEMA DEBE permitir recuperar la contraseña por correo (enlace de un solo uso, expira en 1 h). CUANDO se restablece o cambia la contraseña, EL SISTEMA DEBE revocar las demás sesiones del usuario.
- CUANDO haya 5 intentos de login fallidos en 10 minutos desde una IP, EL SISTEMA DEBE bloquear los intentos de login de esa IP durante 15 minutos. La IP se toma de `X-Forwarded-For` solo si la petición viene del proxy de confianza (Caddy).
- Las respuestas de login, registro y recuperación NO DEBEN revelar si un email existe.
- *Diseño (M2)*: el entrypoint `web` calcula la IP del cliente (X-Forwarded-For solo si la conexión llega desde `TRUSTED_PROXY_CIDRS`) y la fija en `x-ags-client-ip`, sobrescribiendo la del cliente; Better Auth y el bloqueo solo leen esa cabecera. Cuenta como fallo solo un 401 (credenciales inválidas). Además, rate limit de Better Auth por endpoint (p. ej. login 10/min, recuperación 5/15 min). `Secure` se activa cuando `APP_URL` es https. Si una cuenta sin verificar entra con la contraseña correcta, se le reenvía el enlace (no revela nada: exige la contraseña).

**R-004 Gestión de cuenta**
- EL SISTEMA DEBE permitir al usuario: cambiar nombre, contraseña y email (el nuevo email requiere verificación), ver sus sesiones activas y cerrarlas (una o todas), activar/desactivar 2FA (TOTP con códigos de respaldo) y eliminar su cuenta.
- CUANDO un usuario elimina su cuenta y es el único owner de su organización, EL SISTEMA DEBE eliminar también la organización y sus datos.
- *Diseño (M2)*: cambiar el email exige aprobarlo desde el correo actual y después confirmar el nuevo. 2FA por TOTP (app) con 10 códigos de respaldo cifrados; al verificar se puede confiar en el dispositivo 30 días. Eliminar la cuenta pide la contraseña. Las sesiones se listan sin exponer tokens al navegador.

**R-005 Organizaciones (multi-tenencia)**
- CUANDO un usuario verifica su email por primera vez, EL SISTEMA DEBE crear su organización con él como *owner* si aún no tiene una.
- Todos los datos de negocio (sitios y todo lo que cuelga de ellos, gasto, reportes) DEBEN pertenecer a una organización.
- EL SISTEMA DEBE garantizar en la capa de servidor que un usuario solo lea y modifique datos de las organizaciones de las que es miembro; un acceso a un recurso ajeno DEBE responder como "no encontrado".
- *Diseño (M2)*: cada sesión guarda su organización activa; `organizationMiddleware` (src/functions) la valida contra `member` e inyecta `organizationId`, y toda server function de datos de negocio debe usarlo y filtrar por él. Los endpoints HTTP del plugin organization que no se usan (crear, borrar, invitar, miembros) responden 404 hasta el módulo "Equipo".

**R-006 Staff**
- EL SISTEMA DEBE distinguir el rol de plataforma `staff` del rol `user`. El primer staff se crea con un comando de CLI, nunca desde la UI.
- Un usuario staff DEBE tener 2FA activado para acceder al panel de staff.
- EL SISTEMA DEBE ofrecer a staff: lista de usuarios y organizaciones, suspender/reactivar usuarios (un usuario suspendido no puede iniciar sesión y sus sesiones se revocan) e impersonar a un usuario, con un indicador visible y una forma de salir de la impersonación.
- *Diseño (M2)*: CLI `create-staff` (`pnpm staff:create` o `node dist/node/create-staff.mjs` en el contenedor). Staff sin 2FA es redirigido a Cuenta → Seguridad; los endpoints `/api/auth/admin/*` también exigen staff con 2FA. La impersonación dura como máximo 1 h y no se puede suspender ni impersonar a otro staff.

**R-007 Email transaccional**
- EL SISTEMA DEBE enviar correos (verificación, recuperación, cambio de email) a través de una interfaz `EmailProvider`.
- `web` renderiza el correo y lo encola en `email.send` (pg-boss); `worker` lo envía con la política de R-071 (reintentos y `email.send.dead`). Los jobs de correo se borran a las 24 h porque llevan enlaces con token.
- En desarrollo DEBE usarse Mailpit (bandeja local); en producción, Resend.

**R-002 Gestión de sitios**
- EL SISTEMA DEBE permitir CRUD de sitios dentro de una organización (una organización puede tener N sitios). La organización reemplaza a la entidad "cliente" de v0.1.
- Cada sitio DEBE tener: dominio canónico, propiedad GSC, sitio Bing, ubicación principal (lat/lng, ciudad), idioma/país, estado (activo/pausado).
- CUANDO un sitio está pausado, EL SISTEMA NO DEBE ejecutar jobs que consuman créditos para ese sitio. Tampoco se audita (R-034).
- *Diseño (M3)*: el dominio se normaliza en `domain/sites.ts` (minúsculas, sin esquema/ruta/puerto, punycode; se rechazan IPs y nombres sin TLD) y es **único por organización**, contando `www.` como el mismo sitio (`domain_key`). No es único global: así nadie puede ocupar un dominio ajeno ni averiguar qué dominios son clientes; la propiedad real se comprueba con GSC (M6). La propiedad GSC (`sc-domain:` o prefijo de URL) y el sitio de Bing deben pertenecer al dominio; ambos son opcionales hasta M6. Todo job de pago obtiene el sitio con `siteForPaidWork()` (src/server/sites.ts), que devuelve `null` si está pausado; la regla pura es `siteAllowsPaidWork()`.

**R-003 Control de gasto**
- EL SISTEMA DEBE registrar cada llamada a un proveedor de pago (proveedor, costo estimado, organización, sitio, job).
- EL SISTEMA DEBE tener un tope mensual global, por proveedor y por organización, configurable por staff.
- CUANDO un job fuera a exceder cualquier tope, EL SISTEMA DEBE omitirlo, registrar el motivo y enviar alerta (R-061).
- *Diseño (M4)*: todo job de pago llama al proveedor dentro de `withPaidCall()` (src/server/spend.ts). Esta evalúa los topes y reserva el costo estimado en `spend_ledger` en una transacción serializada (advisory lock), así que llamadas concurrentes no pueden pasarse del tope; después cierra la fila con el costo real (o `error`, conservando el estimado). Topes en USD por mes calendario UTC: global (**obligatorio**: sin él no se gasta nada), por proveedor, por organización por defecto y por organización propio. La alerta se registra en `alerts`, deduplicada por tope y mes (`occurrences`), y se ve en Staff → Gasto; **el envío por Telegram llega con R-061 (M12)**. `pnpm spend:demo` simula llamadas en desarrollo.

### 4.2 Colectores gratuitos

**R-010 Search Console**
- EL SISTEMA DEBE autenticarse con una *service account* agregada como usuario en cada propiedad GSC.
- Diariamente, EL SISTEMA DEBE importar por sitio: consultas, páginas, país y dispositivo con clics, impresiones, CTR y posición media.
- EL SISTEMA DEBE importar con ventana de reingesta de 4 días (los datos de GSC llegan con retraso) y de forma idempotente.
- SI la API expone los informes de funciones generativas, EL SISTEMA DEBE importarlos en tablas separadas (ver pregunta abierta Q1).

**R-011 Bing Webmaster Tools**
- EL SISTEMA DEBE importar diariamente las métricas de búsqueda por sitio vía API key.
- SI la API expone AI Performance (citas, páginas citadas, grounding queries), EL SISTEMA DEBE importarlo (Q2).

**R-012 Estado de indexación**
- EL SISTEMA DEBE verificar semanalmente, con la URL Inspection API de GSC, el estado de indexación de las URLs del sitemap de cada sitio, respetando la cuota de la API.

### 4.3 Bots y logs

**R-020 Ingesta de logs de Caddy**
- EL SISTEMA DEBE leer los access logs JSON de Caddy (montados en solo lectura) de forma incremental, sin reprocesar líneas.
- EL SISTEMA DEBE clasificar por user-agent al menos: Googlebot, Bingbot, GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-SearchBot, Claude-User, PerplexityBot, Perplexity-User, Applebot, y "otro".
- EL SISTEMA DEBE guardar por hit: timestamp, host, path, status, bytes, user-agent, IP, bot clasificado, verificado (sí/no/desconocido).

**R-021 Verificación de bots**
- Para bots con rangos IP publicados (p. ej. OpenAI), EL SISTEMA DEBE verificar contra listas actualizadas diariamente.
- Para Googlebot y Bingbot, EL SISTEMA DEBE verificar con DNS inverso + DNS directo, con caché por IP.
- CUANDO no exista método de verificación publicado, EL SISTEMA DEBE marcar el hit como `unverified`, nunca como verificado.

**R-022 Métricas de bots**
- EL SISTEMA DEBE mostrar por sitio y semana: hits por bot verificado, páginas más visitadas por bots de IA, y respuestas 4xx/5xx a bots.
- CUANDO un bot de búsqueda verificado reciba ≥ 5 respuestas 4xx/5xx en 24 h, EL SISTEMA DEBE alertar.

**R-023 Retención**
- EL SISTEMA DEBE conservar hits crudos 90 días y agregados diarios indefinidamente.

### 4.4 Auditoría técnica

**R-030 HTML sin JavaScript**
- Por cada URL del sitemap, EL SISTEMA DEBE obtener el HTML con una petición HTTP simple (sin JS) y verificar: `<title>`, meta description, `<h1>` único, canonical, meta robots, presencia de texto principal (umbral configurable de caracteres).
- EL SISTEMA DEBE comparar contra el DOM renderizado con Playwright y reportar contenido que **solo** existe tras ejecutar JS.
- *Diseño (M8)*: las URLs salen de los sitemaps declarados en `robots.txt` (o `/sitemap.xml` si no hay), con índices y gzip; sin sitemap se audita la portada y se reporta. Topes por auditoría: 500 URLs, respuestas de 5 MB (sitemaps 50 MB), 250 ms entre peticiones, user-agent propio `ags-io-audit`. **SSRF**: el cliente HTTP (`src/audit/http.ts`) solo conecta por http(s) a los puertos 80/443 y valida la IP en el `lookup` de cada socket (también tras redirecciones y contra DNS rebinding), rechazando direcciones privadas, locales y reservadas. Texto principal = `<main>` o, si no hay, el `<body>` sin navegación; umbral `AUDIT_MIN_TEXT_CHARS` (250 por defecto). Las reglas son un catálogo en `domain/audit/rules.ts` con severidad `error`/`warning`/`notice`; sus ids no se renombran (rompería el diff).

**R-031 Datos estructurados**
- EL SISTEMA DEBE extraer todos los bloques JSON-LD, validarlos contra el vocabulario de schema.org y reportar errores.
- EL SISTEMA DEBE comparar el nombre, dirección y teléfono del JSON-LD `LocalBusiness` contra los datos del sitio registrados en R-002 y reportar discrepancias.

**R-032 Rastreo y robots**
- EL SISTEMA DEBE descargar el `robots.txt` **servido públicamente** y evaluar si cada bot de R-020 puede acceder a las rutas clave.
- EL SISTEMA DEBE validar el sitemap: URLs 200, canónicas y `lastmod` presente.
- EL SISTEMA DEBE detectar enlaces internos rotos.

**R-033 Rendimiento**
- EL SISTEMA DEBE consultar la PageSpeed Insights API (móvil y escritorio) para las URLs clave y guardar: datos de laboratorio y datos de campo CrUX (LCP, INP, CLS al p75) cuando existan.
- EL SISTEMA NO DEBE ejecutar Lighthouse localmente en v1.

**R-034 Programación y recursos**
- Las auditorías DEBEN ejecutarse semanalmente en ventana nocturna (02:00–06:00 America/Mexico_City), con concurrencia de Playwright = 1.
- CUANDO una auditoría termine, EL SISTEMA DEBE generar un puntaje de salud por sitio y un diff contra la auditoría anterior.
- *Diseño (M8)*: `audit.schedule` corre los lunes a las 02:00 America/Mexico_City (`missed: once`) y crea una auditoría por sitio **activo** (los pausados no se auditan: Chromium consume RAM de la VPS compartida). `audit.run` procesa de una en una; una programada que no alcanza a empezar dentro de la ventana se difiere al siguiente inicio de ventana. El cliente puede pedir una **auditoría manual** por sitio cada 24 h, que corre al momento (fuera de la ventana, con la misma concurrencia 1). Un índice parcial impide dos auditorías pendientes del mismo sitio. Se conservan páginas y hallazgos de las últimas 12 auditorías por sitio; de las anteriores, score y resumen. Las que el worker no terminó se marcan fallidas (en curso > 6 h, en cola > 7 días). `pnpm audit:run <dominio|id> [--inline]` lanza una sin la espera de 24 h (desarrollo y soporte).

### 4.5 Rank tracking

**R-040 Keywords**
- EL SISTEMA DEBE permitir definir keywords por sitio con: ubicación (ciudad o coordenadas), idioma, dispositivo y etiqueta de grupo.

**R-041 SERP orgánico**
- Semanalmente (configurable), EL SISTEMA DEBE consultar el proveedor de SERP (Serper por defecto) por cada keyword y guardar la respuesta cruda completa.
- EL SISTEMA DEBE extraer: posición orgánica del dominio, URL que rankea, presencia de local pack, posición en local pack, presencia de AI Overview y si el dominio es citado en él (cuando el proveedor lo exponga).

**R-042 Geo-grid local**
- Mensualmente, EL SISTEMA DEBE ejecutar búsquedas de Maps en una malla N×N (default 3×3, máx 7×7) alrededor de la ubicación del sitio y guardar la posición por punto (Q4).
- EL SISTEMA DEBE mostrar el resultado como heatmap.

**R-043 Abstracción de proveedores**
- Los proveedores de SERP DEBEN implementarse detrás de una interfaz común (`SerpProvider`) para poder cambiar Serper por DataForSEO sin cambiar el dominio.

### 4.6 GEO (visibilidad en IA)

**R-050 Prompts**
- EL SISTEMA DEBE permitir definir prompts por sitio con: texto, intención (categoría / evaluación / decisión), si incluye la marca (sí/no), idioma y ubicación.
- EL SISTEMA DEBE mantener una lista de competidores y alias de marca por sitio.

**R-051 Registro manual**
- EL SISTEMA DEBE ofrecer un formulario para registrar una corrida manual: motor, modo, fecha, respuesta pegada y URLs citadas.
- CUANDO se guarde una corrida manual, EL SISTEMA DEBE extraer automáticamente las menciones (R-053).

**R-052 Corridas automáticas**
- EL SISTEMA DEBE ejecutar cada prompt activo N veces (default 3, configurable) por motor habilitado, con la frecuencia configurada.
- Motores v1: los que tengan API oficial con búsqueda web; empezar con uno solo (Q3).
- EL SISTEMA DEBE guardar la respuesta cruda, las citas/fuentes devueltas, el modelo, los parámetros y el costo.

**R-053 Extracción de menciones**
- Para cada respuesta, EL SISTEMA DEBE detectar: menciones de la marca (con alias), menciones de competidores, dominios citados y si cita el dominio propio.
- La detección DEBE ser primero determinista (coincidencia de alias/dominios); solo usar un LLM barato para desambiguar casos marcados como dudosos.

**R-054 Métricas GEO**
- EL SISTEMA DEBE calcular por prompt, motor y periodo: tasa de mención (% de corridas), tasa de cita del dominio, share of voice contra competidores y dominios fuente más citados.
- EL SISTEMA DEBE mostrar tamaño de muestra junto a cada métrica y NO DEBE mostrar "posición" como métrica GEO.

### 4.7 Reportes y alertas

**R-060 Reporte mensual**
- EL SISTEMA DEBE generar por sitio un reporte mensual (ruta HTML imprimible + PDF generado con Playwright) con: resumen, GSC/Bing, rankings, geo-grid, bots de IA, métricas GEO, salud técnica y acciones recomendadas (texto editable por el admin).
- EL SISTEMA DEBE permitir compartir el reporte con un enlace firmado y con expiración.

**R-061 Alertas**
- EL SISTEMA DEBE enviar alertas por Telegram para: caída de posición ≥ 5 en keyword marcada como prioritaria, errores masivos a bots (R-022), JSON-LD roto, sitio caído (≥ 3 checks fallidos), tope de gasto (R-003) y fallo repetido de un job.

### 4.8 No funcionales

**R-070 Recursos**: contenedor `web` con `mem_limit` 384 MiB; contenedor `worker` con `mem_limit` 1 GiB; Postgres con 256 MiB.
**R-071 Resiliencia**: jobs idempotentes, con reintentos exponenciales (máx 3; 30 s base, tope 1 h) y dead-letter por cola (`<cola>.dead`, retención 30 días) visible en el dashboard.
- *Diseño (M4)*: Staff → Jobs muestra cada cola (en cola, activos, fallidos y dead-letter) y los jobs muertos con su error, que se busca en el intento fallido de la cola de origen (retenido según su `deleteAfterSeconds`). "Reintentar" usa `redrive` de pg-boss y devuelve el job a su cola con un nuevo ciclo de intentos; "Descartar" lo borra. Los datos se muestran con lo sensible oculto (tokens, URLs, cuerpos de correo).
**R-072 Respaldos**: `pg_dump` diario + restic hacia Cloudflare R2, retención 7 diarios / 4 semanales / 6 mensuales. Restauración probada al menos una vez antes de tener clientes.
**R-073 Seguridad**: secretos solo en `.env` (permisos 600, en `.gitignore`); Postgres solo en red interna; el dashboard es el único servicio en la red `web` de Caddy.
**R-074 Observabilidad**: logs estructurados (JSON) a stdout con rotación de Docker; endpoint `/healthz` para web y heartbeat del worker en DB.
- `/healthz` responde 200 solo si Postgres responde y no hay migraciones pendientes; si no, 503. Informa el estado del worker (`ok`/`stale`/`missing`) sin afectar el código HTTP.
- El heartbeat es un job de pg-boss con cron cada minuto: prueba cron, cola y worker de punta a punta. Sin latido en 3 min = worker `stale`.
**R-075 Zona horaria**: almacenar todo en UTC; mostrar en America/Mexico_City.

---

## 5. Arquitectura

```
                Internet
                    │
            ┌───────▼────────┐
            │     Caddy      │  (proyecto compose existente)
            │  access logs   │──── /var/log/caddy/*.json ───┐ (ro)
            └───┬────────┬───┘                              │
   sites estáticos│      │ seo.<dominio>                    │
   (/srv/sites/*) │      ▼                                  │
                  │  ┌──────────┐     ┌──────────┐          │
                  │  │   web    │     │  worker  │◄─────────┘
                  │  │ TanStack │     │ pg-boss  │
                  │  │  Start   │     │Playwright│
                  │  └────┬─────┘     └────┬─────┘
                  │       │   red interna  │
                  │       └──────┬─────────┘
                  │         ┌────▼─────┐
                  │         │ Postgres │ ──► pg_dump + restic ──► R2
                  │         └──────────┘
                  │
     APIs externas: GSC · Bing · PageSpeed · Serper · LLMs · Telegram
```

- **Una sola imagen Docker**, dos servicios (`web` y `worker`) con distinto `command`.
- `worker` monta los logs de Caddy en **solo lectura**.
- Los sitios de clientes los sirve Caddy directamente con `file_server` (repo `sites`, §9).

---

## 6. Stack

| Capa | Elección | Nota |
|---|---|---|
| Lenguaje | TypeScript estricto | Node 22 LTS; TypeScript 6.0.x (typescript-eslint aún no soporta TS 7) |
| Web | TanStack Start (React) | server functions para acciones del dashboard |
| UI | Tailwind + componentes propios/shadcn | sin dependencias pesadas de charts; usar una librería ligera |
| DB | PostgreSQL 16 local | JSONB para respuestas crudas |
| ORM | Drizzle 0.45 (estable) + drizzle-kit | migraciones versionadas, aplicadas en el arranque del contenedor `web` con advisory lock |
| Servidor Node | srvx + entrypoints propios empaquetados con esbuild | `dist/node/web.mjs` (migra, sirve estáticos, delega en Start) y `dist/node/worker.mjs`; sin Nitro (beta) |
| Colas/cron | pg-boss | sin Redis |
| Navegador | Playwright (Chromium) | solo en worker |
| Validación | Zod | entradas, configs y respuestas de APIs |
| Auth | Better Auth (autohospedado, adaptador Drizzle) | plugins `organization`, `admin`, `twoFactor`; hash argon2id |
| Email | Resend (prod) · Mailpit (dev) | detrás de `EmailProvider`; ambos por su API HTTP con `fetch` (sin SDK) |
| Verificación | `pnpm check` = typecheck + lint + format + build | **sin unit tests**; cada módulo se valida con e2e manual del admin |
| Calidad de commits | lefthook + commitlint (Conventional Commits) · hooks de Claude Code · skill `/ship-task` | formato `tipo(M<n>): resumen [R-XXX]` |
| CI/CD | GitHub Actions → GHCR → SSH `docker compose pull && up -d` | nunca compilar en la VPS |
| Paquetes | pnpm | un solo package, sin monorepo |

---

## 7. Estructura del repo

```
ags-io/
  SPEC.md
  README.md
  .env.example
  Dockerfile
  docker-compose.yml       # base: dev y prod (Postgres interno, web, worker)
  docker-compose.override.yml # solo dev (auto-cargado): puertos en loopback y Mailpit
  docker-compose.prod.yml  # override prod: red externa de Caddy, imágenes GHCR
  drizzle.config.ts
  lefthook.yml
  commitlint.config.ts
  .claude/                 # hooks de Claude Code y skill /ship-task
  .github/                 # plantilla de PR (y workflows desde el módulo Deploy)
  src/
    routes/                # TanStack Start (dashboard, panel staff, reportes)
    functions/             # server functions y middlewares (auth, organización, staff); importables desde la UI
    server/                # solo servidor: Better Auth, consultas, entrypoint web, CLIs (bloqueado en el cliente)
    queue/                 # definición de colas compartida por web (produce) y worker (consume)
    components/            # componentes de UI
    worker/
      index.ts             # entrypoint del worker
      jobs/                # un archivo por job (gsc.import, bots.ingest, audit.run, ...)
      schedule.ts          # definición de crons
    db/
      schema/              # tablas Drizzle por dominio
      migrations/
    domain/                # lógica pura y testeable (métricas, clasificación, scoring)
    providers/
      serp/                # SerpProvider + serper.ts
      llm/                 # LlmProvider + un adaptador por motor
      gsc.ts
      bing.ts
      pagespeed.ts
      telegram.ts
      email/               # EmailProvider + resend.ts + mailpit.ts (API HTTP de Mailpit en dev)
    audit/                 # fetch sin JS, playwright, jsonld, robots, sitemap
    bots/                  # parser de logs, clasificador, verificación
    lib/                   # utilidades (env, costos, dinero, fechas, logger)
  scripts/                 # tareas de desarrollo (migrar, build de entrypoints Node)
```

Regla: `domain/` no importa nada de `providers/`, `db/` ni frameworks. La hace cumplir ESLint (`no-restricted-imports`).

---

## 8. Modelo de datos (inicial)

Todos los timestamps son `timestamptz` en UTC (R-075).

```
-- Auth (Better Auth: núcleo + plugins organization, admin y twoFactor; src/db/schema/auth.ts)
user           (id, name, email, email_verified, image, role user|staff, banned, ban_reason,
                ban_expires, two_factor_enabled, created_at, updated_at)
session        (id, user_id, token, expires_at, ip_address, user_agent, active_organization_id,
                impersonated_by, created_at, updated_at)
account        (id, user_id, provider_id, account_id, password, tokens OAuth…)  -- hash argon2id
verification   (id, identifier, value, expires_at)                -- identificador hasheado
two_factor     (id, user_id, secret, backup_codes, verified, failed_verification_count,
                locked_until)                                      -- backup codes cifrados
organization   (id, name, slug, logo, metadata, created_at)       -- reemplaza a clients
member         (id, organization_id, user_id, role owner|admin|member, created_at)
invitation     (id, organization_id, email, role, status, inviter_id, expires_at)  -- sin uso hasta "Equipo"
login_failures (id, ip, attempted_at)                              -- R-001 bloqueo por IP
worker_heartbeat (worker_id, version, started_at, beat_at)        -- R-074

sites          (id, organization_id, domain, domain_key, gsc_property, bing_site, city, lat, lng,
                locale, country, status active|paused, created_at, updated_at)
                -- único (organization_id, domain_key); business_json se añade cuando un módulo lo use
competitors    (id, site_id, name, aliases text[], domains text[])
brand_aliases  (id, site_id, alias)

gsc_daily      (site_id, date, query, page, country, device, clicks, impressions, ctr, position)
gsc_ai_daily   (site_id, date, ... )                      -- si Q1 = sí
bing_daily     (site_id, date, query, clicks, impressions, position)
bing_ai_daily  (site_id, date, citations, page, grounding_query) -- si Q2 = sí
index_status   (site_id, url, checked_at, verdict, coverage_state)

bot_hits       (id, ts, host, path, status, bytes, ua, ip, bot, verified)   -- 90 días
bot_daily      (site_id, date, bot, verified, hits, errors_4xx, errors_5xx)
log_cursors    (file, inode, offset, updated_at)
ip_verifications (ip, bot, verified, method, checked_at)

audits         (id, site_id, trigger scheduled|manual, status queued|running|done|failed,
                requested_by, created_at, started_at, finished_at, score, summary jsonb, error)
                -- único (site_id) donde status en queued|running
audit_pages    (id, audit_id, url, final_url, status, content_type, bytes, ms, error, facts jsonb)
audit_findings (id, audit_id, url, rule, severity error|warning|notice, detail jsonb)
psi_results    (id, site_id, url, strategy, lab jsonb, field jsonb, fetched_at)

keywords       (id, site_id, text, location, lat, lng, device, locale, group, priority)
serp_snapshots (id, keyword_id, provider, fetched_at, raw jsonb, cost_usd)
rank_results   (snapshot_id, organic_pos, url, local_pack, local_pos, ai_overview, ai_cited)
grid_runs      (id, keyword_id, size, spacing_m, fetched_at, cost_usd)
grid_points    (run_id, row, col, lat, lng, position)

prompts        (id, site_id, text, intent, branded, locale, location, active)
llm_runs       (id, prompt_id, engine, model, mode, source manual|auto, run_at,
                raw jsonb, citations jsonb, cost_usd)
mentions       (run_id, entity_type brand|competitor, entity_id, cited_own_domain, snippet)
cited_domains  (run_id, domain, url)

reports        (id, site_id, period, html_path, pdf_path, share_token, expires_at)
spend_ledger   (id, at, provider, job, job_id, organization_id, site_id, estimated_cost_usd,
                cost_usd, status pending|ok|error)              -- se conserva al borrar org/sitio
spend_limits   (scope global|provider|organization|organization_default, key, monthly_usd,
                updated_by, updated_at)
alerts         (id, type, dedupe_key unique, organization_id, site_id, payload jsonb,
                occurrences, first_at, last_at, sent_at)
settings       (key, value jsonb)
```

---

## 9. Repo de sitios (`sites`) — spec resumido

Repo separado en Astro. Sus requisitos se listan aquí solo porque la herramienta los audita.

- **S-001** Cada cliente se define en `clients/<slug>/business.json` (validado con Zod): nombre, dirección, teléfono, geo, horarios, servicios, zonas, redes, reseñas destacadas.
- **S-002** El build genera por cliente: páginas de servicio y zona, JSON-LD (`LocalBusiness` o su subtipo, `Organization`, `BreadcrumbList`), `sitemap.xml` con `lastmod` real y `robots.txt` con política por bot.
- **S-003** Todo el contenido principal está en el HTML inicial; JS solo para mejoras progresivas.
- **S-004** Presupuestos de rendimiento verificados en CI (LCP, CLS, peso de JS).
- **S-005** GitHub Actions construye, hace rsync a `/srv/sites/<slug>` y hace ping a IndexNow con las URLs cambiadas.
- **S-006** El sitio personal del admin es el primer sitio del repo y el sitio piloto de ags-io.

---

## 10. Plan de implementación (módulos)

### M0 — Preparación de la VPS (antes de desplegar nada)
- [x] T0.1 Aplicar actualizaciones pendientes y reiniciar.
- [x] T0.2 Crear swap de 4 GB (`vm.swappiness=10`).
- [x] T0.3 Activar firewall (UFW o el de Hetzner): 22, 80, 443/tcp y 443/udp.
- [x] T0.4 Configurar rotación de logs en `/etc/docker/daemon.json`.
- [x] T0.5 `docker builder prune` y quitar el contenedor `hello-world`.
- [x] T0.6 Poner `mem_limit` a los contenedores existentes.
- [x] T0.7 Activar access logs JSON en Caddy por sitio, con rotación.
- [ ] T0.8 Mover el build de Vesti a GitHub Actions + GHCR.

### M1 — Base (R-070, R-071, R-073–R-075)
- [x] T1.1 Scaffold TanStack Start + TS estricto + pnpm + ESLint (regla de `domain/`) + Prettier + `pnpm check`.
- [x] T1.2 lefthook + commitlint, hooks de Claude Code, skill `/ship-task`, plantilla de PR.
- [x] T1.3 `docker-compose.yml` (Postgres 16 en red interna, `mem_limit`, Mailpit en dev) + `docker-compose.prod.yml` + Dockerfile base.
- [x] T1.4 Env validado con Zod, logger JSON, UTC; Drizzle + migraciones aplicadas al arrancar `web`.
- [x] T1.5 Worker con pg-boss (reintentos exponenciales máx 3, dead-letter) + heartbeat + `/healthz`.
- **E2E del admin**: `docker compose up` levanta todo; `/healthz` responde 200 y 503 si Postgres cae; el heartbeat del worker se actualiza en DB; un commit con mensaje inválido es rechazado.

### M2 — Cuentas (R-001, R-004, R-005, R-006, R-007)
- [x] T2.1 Better Auth + esquema Drizzle + argon2id + `EmailProvider` (Mailpit/Resend).
- [x] T2.2 Registro, verificación de email, login, logout, redirección a la ruta original.
- [x] T2.3 Recuperación de contraseña + bloqueo por IP + respuestas que no revelan emails.
- [x] T2.4 Creación automática de organización + guard de organización en el servidor.
- [x] T2.5 Ajustes de cuenta: perfil, contraseña, email, sesiones, 2FA, eliminar cuenta.
- [x] T2.6 Panel de staff: CLI para crear el primer staff, 2FA obligatorio, usuarios/organizaciones, suspender, impersonar.

### M3 — Sitios (R-002)
- [x] T3.1 Esquema y CRUD de sitios por organización, validación Zod, dominio normalizado y único.
- [x] T3.2 Estado activo/pausado + regla de dominio "pausado no gasta créditos".

### M4 — Gasto y operación (R-003, R-071)
- [x] T4.1 `spend_ledger` + topes global, por proveedor y por organización.
- [x] T4.2 Vista de staff: gasto del mes y jobs fallidos (dead-letter) con reintento manual.

> **Orden**: M5 espera al dominio (Q6); mientras tanto se avanza con M8 y los módulos que no dependen de él.

### M5 — Deploy y respaldos (R-072, R-073) — requiere dominio (Q6)
- [ ] T5.1 Dockerfile multi-stage endurecido, workflow CI (`pnpm check` + build) → GHCR → deploy por SSH.
- [ ] T5.2 Resend con dominio verificado (SPF/DKIM/DMARC).
- [ ] T5.3 Backups `pg_dump` + restic → R2, con una restauración probada.
- [ ] T5.4 Verificación en la VPS sin exceder los límites de memoria.

### M6 — Colectores gratuitos (R-010, R-011, R-012)
- [ ] T6.1 Service account + cliente GSC + job diario idempotente.
- [ ] T6.2 Cliente Bing + job diario.
- [ ] T6.3 Resolver Q1/Q2 e importar datos de IA si existen.
- [ ] T6.4 Job semanal de URL Inspection con respeto de cuota.
- [ ] T6.5 Vistas del dashboard: tendencias por sitio.

### M7 — Bots (R-020–R-023)
- [ ] T7.1 Montaje ro de logs + lector incremental con cursor.
- [ ] T7.2 Clasificador de user-agents (tabla configurable).
- [ ] T7.3 Verificación: rangos publicados + DNS inverso con caché.
- [ ] T7.4 Agregados diarios, retención y vista de bots de IA.

### M8 — Auditor (R-030–R-034)
- [x] T8.1 Fetch sin JS (cliente HTTP con protección SSRF) + sitemaps + reglas on-page + job semanal en ventana + auditoría manual + vista por sitio.
- [ ] T8.2 Diff contra DOM de Playwright.
- [ ] T8.3 Extracción y validación de JSON-LD + chequeo de nombre, dirección y teléfono.
- [ ] T8.4 robots.txt público por bot + validación de sitemap + enlaces rotos.
- [ ] T8.5 PageSpeed Insights API (lab + CrUX).
- [ ] T8.6 Score de salud y diff entre auditorías.

### M9 — Rank tracking (R-040–R-043)
- [ ] T9.1 `SerpProvider` + adaptador Serper.
- [ ] T9.2 Keywords CRUD + job semanal + parser de features del SERP.
- [ ] T9.3 Resolver Q4 + geo-grid + heatmap.

### M10 — GEO manual (R-050, R-051, R-053, R-054)
- [ ] T10.1 CRUD de prompts, competidores y alias.
- [ ] T10.2 Formulario de corrida manual.
- [ ] T10.3 Extractor determinista de menciones y dominios citados.
- [ ] T10.4 Métricas con tamaño de muestra.

### M11 — GEO automático (R-052)
- [ ] T11.1 `LlmProvider` + primer adaptador (motor elegido en Q3).
- [ ] T11.2 Job con N repeticiones + registro de costo + topes.
- [ ] T11.3 Desambiguación con LLM barato solo para casos dudosos.
- [ ] T11.4 Segundo motor (solo si el presupuesto lo permite).

### M12 — Reportes y alertas (R-060, R-061)
- [ ] T12.1 Ruta de reporte imprimible + PDF con Playwright.
- [ ] T12.2 Enlaces firmados con expiración.
- [ ] T12.3 Bot de Telegram + reglas de alerta.

**Hito piloto:** M0–M8 aplicados al sitio personal antes de incorporar el primer cliente.

### Backlog (sin orden ni compromiso; se convierte en módulo al priorizarse)
- Equipo: invitar miembros a una organización con roles.
- Login con Google (OAuth).
- Planes, límites por plan y cobro.

---

## 11. Presupuesto de costos

| Etapa | Proveedores | Costo mensual extra |
|---|---|---|
| M1–M5 | Resend (free tier: 3,000 correos/mes) | $0 |
| M6–M8 | GSC, Bing, PageSpeed, logs propios | $0 |
| M9–M10 | Serper (tier gratis inicial) | $0 |
| M11 | 1 motor de LLM por uso | ~$5–20 |
| 5–10 clientes | SERP + 2–3 motores | ~$20–60 |

Todas las cifras son estimaciones; validar con las tarifas vigentes antes de activar cada proveedor.

---

## 12. Riesgos

| Riesgo | Mitigación |
|---|---|
| Chromium agota la RAM y afecta a Vesti | swap, `mem_limit`, concurrencia 1, ventana nocturna, PSI API en vez de Lighthouse local |
| Fuga de datos entre organizaciones | guard de organización obligatorio en cada server function; acceso ajeno = "no encontrado"; checklist en cada PR |
| Abuso de registros (spam, cuentas falsas) | verificación de email obligatoria, rate limiting; evaluar CAPTCHA (p. ej. Turnstile) si aparece abuso |
| Variabilidad de respuestas de LLM | N repeticiones, métricas con tamaño de muestra, tendencias de 4 semanas |
| Cambios en APIs o precios de proveedores | interfaces `SerpProvider`, `LlmProvider` y `EmailProvider`, validación Zod de respuestas, topes de gasto |
| La respuesta de la API de un LLM ≠ la experiencia de la app | documentarlo en el reporte al cliente |
| Riesgo legal de scraping | solo APIs oficiales y proveedores de SERP |
| Pérdida de datos | backups probados en R2 |

---

## 13. Preguntas abiertas (resolver antes de la tarea indicada)

- **Q1** (T6.3) ¿La API de Search Console expone los informes de funciones generativas o solo la UI?
- **Q2** (T6.3) ¿El AI Performance de Bing Webmaster Tools está disponible vía API?
- **Q3** (T11.1) ¿Qué motor primero? Evaluar el tier gratuito de Gemini (¿incluye grounding con búsqueda?) contra el costo por llamada de OpenAI y Perplexity.
- **Q4** (T9.3) ¿Serper permite búsquedas de Maps con coordenadas exactas para el geo-grid, o hace falta otro proveedor?
- **Q6** (M5) Dominio del servicio. No se necesita hasta el deploy; en desarrollo se usa `localhost` y Mailpit.

**Resueltas**
- **Q5** → Better Auth autohospedado (v0.2): el producto es B2C y requiere verificación de email, recuperación, 2FA, organizaciones y panel de staff.
- **Q7** → Resend para email en producción (v0.2): GA, free tier de 3,000 correos/mes sin suscripción. Cloudflare Email Service descartado por ahora: en beta y requiere Workers Paid ($5/mes).

---

## 14. Definición de terminado (global)

Una tarea está terminada cuando:
1. `pnpm check` pasa: tipos en modo estricto, lint, formato y build.
2. El spec refleja cualquier cambio de diseño realizado.
3. Lo que no cubre la verificación estática se documenta como verificación manual en el commit/PR.

Un módulo está terminado cuando:
1. Todas sus tareas están terminadas.
2. Se entregó su guion de prueba e2e (pasos + resultado esperado) y **el admin lo aprobó**.
3. A partir de M5: está desplegado vía CI y verificado en la VPS sin exceder los límites de memoria.
