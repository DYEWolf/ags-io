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
- Cada sitio DEBE tener: dominio canónico, propiedad GSC, sitio Bing, ubicación principal (lat/lng, ciudad), idioma/país, estado (activo/pausado) y rutas clave (R-032, R-033; por defecto `/`). Opcionalmente, los datos del negocio (nombre, calle y número, estado, código postal, teléfono) que audita R-031.
- CUANDO un sitio está pausado, EL SISTEMA NO DEBE ejecutar jobs que consuman créditos para ese sitio. Tampoco se audita (R-034).
- *Diseño (M3)*: el dominio se normaliza en `domain/sites.ts` (minúsculas, sin esquema/ruta/puerto, punycode; se rechazan IPs y nombres sin TLD) y es **único por organización**, contando `www.` como el mismo sitio (`domain_key`). No es único global: así nadie puede ocupar un dominio ajeno ni averiguar qué dominios son clientes; la propiedad real se comprueba con la verificación de M6 (abajo). La propiedad GSC (`sc-domain:` o prefijo de URL) y el sitio de Bing deben pertenecer al dominio; ambos son opcionales hasta M6. Todo job de pago obtiene el sitio con `siteForPaidWork()` (src/server/sites.ts), que devuelve `null` si está pausado; la regla pura es `siteAllowsPaidWork()`.
- *Diseño (M6, verificación de propiedad)*: la service account de Google y la key de Bing son de la plataforma, así que tener acceso a una propiedad no prueba que el sitio sea de quien lo registró (otra organización podría registrar el mismo dominio y leer sus datos). Cada sitio tiene un token (32 hex, `domain/verification.ts`) que se publica como registro TXT `ags-io-verification=<token>` en el dominio sin `www.` o como `<meta name="ags-io-verification" content="<token>">` en el HTML inicial de la portada (descargada con `src/audit/http.ts`; una redirección fuera del dominio no cuenta). **Sin verificar no se importan GSC ni Bing.** El cliente comprueba desde Ajustes (cada 10 s como máximo); un fallo manual no retira una verificación vigente. El job `site.verify` (diario, 03:40 UTC) la revisa y la retira tras 7 fallos seguidos, registrando `site_unverified` en `alerts`. Cambiar el dominio (otra `domain_key`) genera un token nuevo y deja el sitio sin verificar. Soporte: `pnpm site:verify <dominio|id> [--staff | --clear]` comprueba, marca verificado por staff (no se revisa) o retira la verificación.

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
- SI la API expone los informes de funciones generativas, EL SISTEMA DEBE importarlos en tablas separadas. *Q1 resuelta (M6): no los expone*; no se importan hasta que exista API (backlog).
- *Diseño (M6)*: service account de la plataforma (`GOOGLE_SERVICE_ACCOUNT_KEY` en `.env`, el JSON en base64; token JWT firmado con `node:crypto` en `src/providers/google-auth.ts`, sin `google-auth-library`); el cliente la añade como usuario **Restringido** en su propiedad (Ajustes muestra el email y las instrucciones). Solo importan los sitios **activos, verificados (R-002) y con propiedad** (`domain/search/collectors.ts`); al reanudar uno pausado se recupera lo que falte. `gsc.schedule` (10:20 UTC) encola `gsc.sync` por sitio (política `stately`, `singletonKey` = sitio; también lo encola «Importar ahora»). Cada pasada (`domain/search/gsc.ts`) reimporta los últimos 4 días (`dataState: all`; el día en curso no) y, fuera de esa ventana, hasta 30 días de huecos o de historial (16 meses, lo que conserva GSC), encolándose de nuevo mientras falte; `collector_state` guarda el tramo **continuo** importado (`oldest`–`newest`), así un hueco a medio llenar nunca se da por cargado. Por día se piden dos consultas de búsqueda web: detalle `query × page × country × device` (hasta 50 000 filas, páginas de 25 000) en `gsc_daily` y totales `country × device` agregados por propiedad en `gsc_totals_daily` (el detalle omite las consultas anonimizadas: las tendencias salen de los totales); ambos se reemplazan por (sitio, día) en una transacción que bloquea la fila del sitio y se aborta si la propiedad cambió. Las fechas son las de GSC (hora del Pacífico) y el país es ISO alfa-3 en minúsculas. Cambiar la propiedad borra los datos de GSC del sitio y la carga empieza de cero. 403/404 → estado «sin acceso» (sin reintento); 429, 5xx y red → reintento del job, conservando lo importado. Retención: detalle 16 meses, totales indefinidos. Gratuita: no pasa por R-003.

**R-011 Bing Webmaster Tools**
- EL SISTEMA DEBE importar diariamente las métricas de búsqueda por sitio vía API key.
- SI la API expone AI Performance (citas, páginas citadas, grounding queries), EL SISTEMA DEBE importarlo. *Q2 resuelta (M6): no lo expone*; no se importa hasta que exista API (backlog).
- *Diseño (M6)*: API key de la cuenta de Bing de la plataforma (`BING_WEBMASTER_API_KEY`; `BING_ACCOUNT_EMAIL` es el usuario que el cliente añade en su sitio, con rol de solo lectura, y lo muestra Ajustes). Mismas condiciones que GSC: activo, verificado (R-002) y con sitio de Bing. `bing.schedule` (10:40 UTC) encola `bing.sync` (política `stately` por sitio, también desde «Importar ahora»). Cada pasada pide `GetQueryStats`, `GetPageStats` y `GetRankAndTrafficStats`, que devuelven el historial reciente completo de Bing con su propia granularidad de fechas; las fechas WCF (`/Date(ms-0700)/`) se convierten al día de su desfase (hora del Pacífico). Consultas (`bing_daily`) y páginas (`bing_page_daily`) se reemplazan desde la fecha más antigua recibida; los totales (`bing_totals_daily`) se actualizan por día y nunca se borran. Una respuesta vacía no borra nada. ApiErrorCode 7/11/13/14 (p. ej. `NotAuthorized`) → «sin acceso»; 1/2/4/5 y 5xx → reintento; `InvalidApiKey` → error. Cambiar el sitio de Bing borra sus datos. Bing acepta la URL con o sin `www.` y con http o https para el mismo sitio.

**R-012 Estado de indexación**
- EL SISTEMA DEBE verificar semanalmente, con la URL Inspection API de GSC, el estado de indexación de las URLs del sitemap de cada sitio, respetando la cuota de la API.
- *Diseño (M6)*: `inspection.schedule` (martes 11:00 UTC) encola `inspection.run` por sitio importable en GSC (activo, verificado, con propiedad; política `stately` por sitio, también desde «Revisar indexación ahora» en Ajustes). Las URLs salen de los sitemaps (`src/audit/sitemap.ts`, con protección SSRF; sin sitemap, la portada), solo las de la propiedad (`sc-domain:` = dominio y subdominios; prefijo = URLs que empiezan por él), hasta 500, y se omiten las revisadas en los últimos 6 días, así que reanudar no gasta cuota. Una llamada por segundo (límite 600/min). **Cuota**: 2 000 por propiedad y día del Pacífico, reservada antes de cada llamada en `inspection_quota` con un upsert condicional (dos sitios pueden compartir propiedad); agotada, el job se encola para las 00:05 del Pacífico siguiente. La API responde 403 tanto sin acceso como para una URL que no considera de la propiedad: ante un 403 por URL se vuelve a consultar la propiedad y, si hay acceso, solo falla esa URL. `index_status` guarda una fila por revisión (veredicto, cobertura en español, indexación, robots, fetch, último rastreo, canónicas, rastreador) durante 12 semanas. Cambiar la propiedad borra el historial.
- *Diseño (M6, vistas)*: pestaña **Búsqueda** del sitio con tres subpestañas (`src/routes/_app/sitios/$siteId/busqueda`, lógica pura en `domain/search/metrics.ts`). **Google**: periodo de 28 días (por defecto), 3, 6 o 16 meses que termina en el día más reciente importado (hora del Pacífico, como GSC), filtros de dispositivo y país (en la URL); KPIs de clics, impresiones, CTR y posición media (ponderada por impresiones) desde `gsc_totals_daily`, con la variación contra el periodo anterior de la misma duración; tendencias diarias en SVG propio (los días sin filas valen 0; sin impresiones no hay CTR ni posición; la posición se dibuja invertida) y las 25 consultas y páginas principales desde `gsc_daily`, avisando de que Google omite las anonimizadas. **Bing**: mismo periodo, KPIs y tendencia desde `bing_totals_daily` (sin posición) y consultas y páginas principales. **Indexación**: última revisión de cada URL, conteo por veredicto y tabla con lo que necesita atención primero (cobertura, último rastreo y canónica elegida por Google si difiere de la declarada). Cada vista muestra el estado de su fuente y, si no importa (pausado, sin verificar, sin propiedad), el motivo con enlace a Ajustes.

### 4.3 Bots y logs

**R-020 Ingesta de logs de Caddy**
- EL SISTEMA DEBE leer los access logs JSON de Caddy (montados en solo lectura) de forma incremental, sin reprocesar líneas.
- EL SISTEMA DEBE clasificar por user-agent al menos: Googlebot, Bingbot, GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-SearchBot, Claude-User, PerplexityBot, Perplexity-User, Applebot, y "otro".
- EL SISTEMA DEBE guardar por hit: timestamp, host, path, status, bytes, user-agent, IP, bot clasificado, verificado (sí/no/desconocido).
- *Diseño (M7, ingesta)*: el worker monta el directorio de logs en solo lectura en `/var/log/caddy` (`CADDY_LOG_DIR`; en la VPS `CADDY_LOG_HOST_DIR`, por defecto `/var/log/caddy`; en desarrollo `.dev/caddy-logs`, que llena `pnpm bots:sample`, por defecto con el host `bots.example.test`: un host real mostraría datos falsos en su sitio verificado). `bots.ingest` corre cada minuto (política `stately`: nunca dos lecturas a la vez) y lee de cada archivo activo (`*.log`, `*.json`, `*.jsonl` que no sean rotados) lo nuevo desde su cursor en `log_cursors` (inode + offset en bytes, siempre a inicio de línea): solo líneas completas, como mucho 50 MB por pasada (si queda más, se encola otra al momento) y hits en lotes de 1 000 en la **misma transacción** que el avance del cursor, que además solo se mueve si nadie lo movió (así un reintento o una caída no duplican ni pierden líneas). **Rotación**: Caddy renombra el archivo a `<nombre>-<fecha UTC>[-size|-time].<ext>` y lo comprime con gzip; cuando cambia el inode, antes de seguir con el nuevo se termina el rotado que continúa al cursor (`draining`): el que conserva el inode si aún no está comprimido o, si no, el primero con fecha posterior a `inode_since` (desde cuándo se sigue ese inode), leyendo el `.gz` si ya se comprimió; varias rotaciones seguidas (worker caído) se leen en orden. Un archivo más corto que el offset se truncó y se lee desde 0. Se parsean las líneas del logger `http.log.access…` (`ts` en segundos Unix o ISO); IP = `client_ip` (IP real tras proxies de confianza) o `remote_ip`; host en minúsculas sin puerto; path sin query string (puede llevar datos del visitante); líneas de más de 64 KB o inválidas se cuentan y descartan. **Solo se guardan bots** (catalogados u `other`), nunca el tráfico de personas. Los hits van **por host, no por sitio**: un dominio puede estar en varias organizaciones y sus datos solo se muestran al sitio verificado (R-002, R-005). Solo existen logs de los sitios que sirve nuestro Caddy.
- *Diseño (M7, clasificación)*: catálogo en `domain/bots.ts` (`LOG_BOTS`): los bots de la auditoría de robots.txt (con variantes del mismo operador e IPs: `Googlebot-Image/-News/-Video`, `Google-InspectionTool`, `Storebot-Google`, `adidxbot`) más otros frecuentes que no entran en la matriz de la auditoría: buscadores (DuckDuckBot, YandexBot, Baiduspider), asistentes de IA (DuckAssistBot, MistralAI-User, meta-externalfetcher), entrenamiento (meta-externalagent, Amazonbot, Bytespider, CCBot), herramientas SEO (AhrefsBot, SemrushBot, MJ12bot, DotBot, Screaming Frog) y otros (GoogleOther, OAI-AdsBot, vistas previas de enlaces). Se busca cada token como palabra, el más largo primero. Después van las **reglas de staff** (`bot_rules`, Staff → Bots): texto del user-agent sin distinguir mayúsculas (sin expresiones regulares), en orden de creación, que lo asignan a un bot nuevo (nombre, operador y categoría; no puede ser un nombre del catálogo) o lo marcan como «no es un bot»; nunca sobrescriben el catálogo (nadie convierte en Googlebot lo que no lo es). Al final, un user-agent que se declara `bot`, `crawler`, `spider`, `slurp` o `scraper` es `other` (salvo móviles como CUBOT); el resto es una persona y no se guarda. Al crear o borrar una regla, `bots.reclassify` (`stately`) recalcula por user-agent los hits guardados: los que cambian de bot vuelven a `unverified` y los que pasan a persona se borran; lo que ya se descartó como persona no se recupera. Staff → Bots muestra además el estado de la ingesta (archivos, avance, rotado pendiente) y los hits de las últimas 24 h por bot.

**R-021 Verificación de bots**
- Para bots con rangos IP publicados (p. ej. OpenAI), EL SISTEMA DEBE verificar contra listas actualizadas diariamente.
- Para Googlebot y Bingbot, EL SISTEMA DEBE verificar con DNS inverso + DNS directo, con caché por IP.
- CUANDO no exista método de verificación publicado, EL SISTEMA DEBE marcar el hit como `unverified`, nunca como verificado.
- *Diseño (M7)*: métodos en `domain/bot-verification.ts`. **Listas** (formato JSON `prefixes`, descargadas por `bots.ranges` cada día a las 04:10 UTC y guardadas en `bot_ip_ranges`; una descarga fallida o vacía conserva la anterior y queda en `bot_range_sources.last_error`): Googlebot, Bingbot, Applebot, GPTBot, OAI-SearchBot, ChatGPT-User y OAI-AdsBot (una lista cada uno), ClaudeBot, Claude-User y Claude-SearchBot (una lista de Anthropic para los tres), PerplexityBot y Perplexity-User. **DNS inverso + directo** si la IP no está en la lista y el operador lo publica: Googlebot (`googlebot.com`, `google.com`), Bingbot (`search.msn.com`) y Applebot (`applebot.apple.com`); el nombre debe pertenecer al dominio (no basta con contenerlo) y resolver de vuelta a la misma IP. Caché por IP y bot en `ip_verifications`: verificado o fallido 7 días; un error de DNS (no concluyente) 1 hora. Estados: `verified`; `failed` (la IP no está en listas ya descargadas o el DNS no corresponde: suplantación); `unverified` (sin método publicado, o sin poder concluir: lista aún sin descargar, DNS caído). La ingesta verifica cada lote antes de guardarlo; el primer hit sin listas descargadas pide `bots.ranges`, que tras descargar revisa los hits guardados que no están verificados (90 días), igual que `bots.reclassify`. Las descargas usan un user-agent solo ASCII (Bing responde 500 con acentos). Staff → Bots muestra las listas y, por bot, verificados y suplantados de las últimas 24 h.

**R-022 Métricas de bots**
- EL SISTEMA DEBE mostrar por sitio y semana: hits por bot verificado, páginas más visitadas por bots de IA, y respuestas 4xx/5xx a bots.
- CUANDO un bot de búsqueda verificado reciba ≥ 5 respuestas 4xx/5xx en 24 h, EL SISTEMA DEBE alertar.
- *Diseño (M7)*: `bot_daily` agrega por `host_key` (host sin `www.`, como `sites.domain_key`), día de Ciudad de México, bot y verificación: hits, 4xx y 5xx. Se recalcula desde `bot_hits` (transacción con advisory lock) para los días que recibieron hits en cada pasada de la ingesta, para los 90 días tras `bots.reclassify` y `bots.ranges`, y cada día en `bots.retention` (red de seguridad si una pasada falló a medias); nunca toca días cuyos hits crudos ya se purgaron. Pestaña **Bots** del sitio (`src/routes/_app/sitios/$siteId/bots.tsx`, solo para sitios **verificados** porque los datos van por host): semana de lunes a domingo (últimas 12, en la URL); KPIs de hits verificados, de bots de IA verificados, errores 4xx/5xx (sin suplantados) y suplantados; tabla por bot (operador, categoría, verificados, sin verificar —«sin método publicado» si no lo hay—, suplantados, 4xx, 5xx); hits verificados por semana en barras CSS (buscadores, IA, otros); páginas más visitadas por bots de IA y respuestas 4xx/5xx por ruta y estado desde `bot_hits` (25 filas, sin suplantados). Avisa de que solo hay datos de los sitios que sirve ags-io. **Alerta**: tras cada pasada con hits, un buscador (categoría `search`) verificado con ≥ 5 respuestas 4xx/5xx en las últimas 24 h registra `bot_errors` en `alerts` para cada sitio verificado de ese host (deduplicada por sitio, bot y día; las pasadas siguientes actualizan conteo y rutas). Telegram en M12.

**R-023 Retención**
- EL SISTEMA DEBE conservar hits crudos 90 días y agregados diarios indefinidamente.
- *Diseño (M7)*: `bots.retention` (diario, 04:40 UTC) borra por lotes de 10 000 los hits de más de 90 días y la caché de DNS caducada hace más de 30 días, y recalcula los agregados que aún tienen hits crudos. `bot_daily` no se purga.

### 4.4 Auditoría técnica

**R-030 HTML sin JavaScript**
- Por cada URL del sitemap, EL SISTEMA DEBE obtener el HTML con una petición HTTP simple (sin JS) y verificar: `<title>`, meta description, `<h1>` único, canonical, meta robots, presencia de texto principal (umbral configurable de caracteres).
- EL SISTEMA DEBE comparar contra el DOM renderizado con Playwright y reportar contenido que **solo** existe tras ejecutar JS.
- *Diseño (M8)*: las URLs salen de los sitemaps declarados en `robots.txt` (o `/sitemap.xml` si no hay), con índices y gzip; sin sitemap se audita la portada y se reporta. Topes por auditoría: 500 URLs, respuestas de 5 MB (sitemaps 10 MB: uno mayor se reporta como límite, no como error), 250 ms entre peticiones, user-agent propio `ags-io-audit`. **SSRF**: el cliente HTTP (`src/audit/http.ts`) solo conecta por http(s) a los puertos 80/443 y valida la IP en el `lookup` de cada socket (también tras redirecciones y contra DNS rebinding), rechazando direcciones privadas, locales y reservadas. Texto principal = `<main>` o, si no hay, el `<body>` sin navegación; umbral `AUDIT_MIN_TEXT_CHARS` (250 por defecto). Las reglas son un catálogo en `domain/audit/rules.ts` con severidad `error`/`warning`/`notice`; sus ids no se renombran (rompería el diff).
- *Diseño (M8, render)*: Chromium headless shell vía `playwright-core`, una instancia por auditoría, una página a la vez y un contexto nuevo por página (heap de JS limitado a 256 MB), hasta 100 páginas por auditoría (portada primero). **Todo** el tráfico del navegador se intercepta (`context.route`) y se hace con el cliente HTTP del auditor, así que Chromium no abre conexiones propias y hereda la protección SSRF; WebSockets y service workers bloqueados, imágenes, fuentes y video no se descargan. Se compara texto principal, title, description, canonical, meta robots y h1: contenido que solo existe con JS (`js_dependent_content` si sin JS no llega al umbral, `js_added_content` si JS añade ≥ 300 caracteres y ≥ 30 %), cabeceras cambiadas por JS y h1 solo con JS. Memoria del worker (R-070): heap de Node acotado a 192 MB (`--max-old-space-size`); medido en Docker, un sitio SSR de 57 páginas llega a ~375 MiB y uno Shopify de 169 URLs (100 renderizadas, ~12 min) a ~800 MiB de su `mem_limit` de 1 GiB, volviendo a ~250 MiB al terminar. El log `auditoría terminada` incluye `process.memoryUsage()` para vigilarlo en la VPS.

**R-031 Datos estructurados**
- EL SISTEMA DEBE extraer todos los bloques JSON-LD, validarlos contra el vocabulario de schema.org y reportar errores.
- EL SISTEMA DEBE comparar el nombre, dirección y teléfono del JSON-LD `LocalBusiness` contra los datos del sitio registrados en R-002 y reportar discrepancias.
- *Diseño (M8)*: el vocabulario de schema.org se versiona compacto en `src/domain/audit/schemaorg.json` (tipos con supertipos, propiedades con `domainIncludes`, términos reemplazados) y se regenera con `pnpm schemaorg:update`. Se valida el JSON-LD del HTML sin JS (lo que ven los bots de IA): JSON inválido, `@context`, tipos y propiedades inexistentes, propiedades que no aplican al tipo (herencia incluida), términos reemplazados y propiedades que Google exige para resultados enriquecidos de los tipos más comunes (LocalBusiness, BreadcrumbList, Product, Offer, Review, AggregateRating, FAQPage, Event, Recipe, VideoObject, JobPosting). JSON-LD que solo aparece tras ejecutar JS se reporta aparte. La comparación de nombre, dirección y teléfono normaliza acentos, mayúsculas, puntuación y abreviaturas comunes (Av., Col., CDMX…), compara teléfonos por sus últimos 10 dígitos y acepta dirección en texto libre; se evalúa una vez por LocalBusiness distinto del sitio. Si el sitio tiene datos del negocio y ninguna página publica LocalBusiness, se reporta.

**R-032 Rastreo y robots**
- EL SISTEMA DEBE descargar el `robots.txt` **servido públicamente** y evaluar si cada bot de R-020 puede acceder a las rutas clave.
- EL SISTEMA DEBE validar el sitemap: URLs 200, canónicas y `lastmod` presente.
- EL SISTEMA DEBE detectar enlaces internos rotos.
- *Diseño (M8)*: la lista de bots vive en `domain/bots.ts` (la reutiliza M7) con su categoría: buscador, buscador de IA, asistente a petición del usuario y entrenamiento de IA (incluye los tokens solo de robots.txt `Google-Extended` y `Applebot-Extended`). robots.txt se interpreta según RFC 9309 con `*` y `$` (regla más específica; `Allow` gana en empate; grupos propios del bot o, si no, `*`): un 4xx equivale a "sin restricciones" y un 5xx o la falta de respuesta a "todo bloqueado". Se evalúa cada bot contra las **rutas clave** del sitio (hasta 10, por defecto `/`) y la vista muestra la matriz bot × acceso; el bloqueo de buscadores es error, el de buscadores y asistentes de IA aviso y el de entrenamiento solo informativo (es una decisión legítima). Sitemap: URLs que redirigen, bloqueadas para Googlebot y `lastmod` ausente o fuera del formato W3C. Enlaces internos rotos: los que apuntan a páginas ya descargadas reutilizan ese resultado; del resto se piden hasta 300 por auditoría.

**R-033 Rendimiento**
- EL SISTEMA DEBE consultar la PageSpeed Insights API (móvil y escritorio) para las URLs clave y guardar: datos de laboratorio y datos de campo CrUX (LCP, INP, CLS al p75) cuando existan.
- EL SISTEMA NO DEBE ejecutar Lighthouse localmente en v1.
- *Diseño (M8)*: en cada auditoría se mide cada ruta clave en móvil y escritorio (`src/providers/pagespeed.ts`, 2 llamadas simultáneas, un reintento ante 429/5xx/timeout); con `PAGESPEED_API_KEY` la cuota es amplia y sin ella la API funciona con cuota mínima. Es gratuita: no pasa por el control de gasto (R-003). Se guarda en `psi_results` solo lo necesario: puntaje y métricas de laboratorio, y LCP/INP/CLS/FCP/TTFB de campo al p75 de la página o, si no hay suficientes visitas, del origen (`scope`). Hallazgos con los umbrales oficiales de Core Web Vitals (LCP 2.5/4 s, INP 200/500 ms, CLS 0.1/0.25): "malo" es error y "por mejorar" aviso; los de origen se reportan una vez por dispositivo y métrica. Puntaje de laboratorio móvil < 50 es aviso. `psi_results` no se purga con la retención de detalle (son pocas filas y sirven para tendencias).

**R-034 Programación y recursos**
- Las auditorías DEBEN ejecutarse semanalmente en ventana nocturna (02:00–06:00 America/Mexico_City), con concurrencia de Playwright = 1.
- CUANDO una auditoría termine, EL SISTEMA DEBE generar un puntaje de salud por sitio y un diff contra la auditoría anterior.
- *Diseño (M8)*: `audit.schedule` corre los lunes a las 02:00 America/Mexico_City (`missed: once`) y crea una auditoría por sitio **activo** (los pausados no se auditan: Chromium consume RAM de la VPS compartida). `audit.run` procesa de una en una; una programada que no alcanza a empezar dentro de la ventana se difiere al siguiente inicio de ventana. El cliente puede pedir una **auditoría manual** por sitio cada 24 h, que corre al momento (fuera de la ventana, con la misma concurrencia 1); si hay una programada esperando su ventana, esa se adelanta y pasa a manual. La ventana limita el inicio: una auditoría larga puede terminar después de las 06:00. Un índice parcial impide dos auditorías pendientes del mismo sitio. Se conservan páginas y hallazgos de las últimas 12 auditorías por sitio; de las anteriores, score y resumen. Las que el worker no terminó se marcan fallidas (en curso > 6 h, en cola > 7 días). `pnpm audit:run <dominio|id> [--inline]` lanza una sin la espera de 24 h (desarrollo y soporte).
- *Diseño (M8, score y diff)*: score = 100 − Σ penalizaciones por regla incumplida (`domain/audit/score.ts`): error 10, aviso 4, info 1, multiplicado por la proporción de páginas afectadas con un mínimo del 40 % (una regla del sitio resta su peso completo); no restan los límites del auditor, los fallos de PageSpeed ni bloquear el entrenamiento de IA. El diff compara regla + URL contra la última auditoría terminada: nuevos, resueltos y persistentes (muestra hasta 50 de cada uno) y la variación del score; la vista muestra el score con su variación, los cambios y la tendencia del historial. **Alerta (R-061)**: cuando aparece JSON-LD inválido nuevo respecto a la auditoría anterior se registra `jsonld_broken` en `alerts` (Telegram en M12).

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
- *Diseño (M10)*: la configuración vive en la pestaña **GEO** del sitio (Prompts · Marca y competidores) y es gratuita: funciona también con el sitio pausado. Prompt: texto (3–500 caracteres), intención, con marca sí/no, idioma (por defecto el del sitio) y ubicación en texto libre (por defecto la ciudad del sitio); único por sitio según `promptKey` (sin acentos, mayúsculas ni puntuación: «¿Cuál…?» = «cual…»). Un prompt se **archiva** (`active = false`): conserva su historial pero no se mide ni se ofrece al registrar corridas; borrarlo elimina sus corridas. Con corridas, su texto ya no se edita (cambiaría el significado del historial; el servidor lo rechaza). Competidor: nombre, alias y dominios (guardados con `domainKey`; se aceptan URLs); el nombre siempre cuenta como alias. Alias de marca: una lista que se guarda completa; sin alias no se mide la mención y se sugieren el nombre del negocio y el dominio sin TLD (guiones como espacios). Los términos se comparan con `matchKey` (sin acentos ni mayúsculas, espacios colapsados) y un mismo término no puede ser de la marca y de un competidor, ni de dos competidores (la extracción no sabría a quién atribuirlo). Límites por sitio: 100 prompts, 30 competidores, 20 alias y 20 dominios por entidad (alias de 2 a 100 caracteres). Las escrituras bloquean la fila del sitio (`FOR UPDATE`) para que límites y conflictos no se salten con peticiones concurrentes; un prompt o competidor de otra organización responde "no encontrado".

**R-051 Registro manual**
- EL SISTEMA DEBE ofrecer un formulario para registrar una corrida manual: motor, modo, fecha, respuesta pegada y URLs citadas.
- CUANDO se guarde una corrida manual, EL SISTEMA DEBE extraer automáticamente las menciones (R-053).
- *Diseño (M10)*: GEO → Corridas: lista paginada (25) con filtros por prompt y motor, alta desde la lista o desde cada prompt, detalle con la respuesta y sus URLs, edición y borrado (solo corridas manuales; las automáticas de M11 no se editan). Motor: ChatGPT, Perplexity, Gemini, Google AI Overviews, Google AI Mode, Microsoft Copilot o Claude; modo opcional (estándar, con búsqueda web, razonamiento, deep research); modelo y notas en texto libre. La fecha se captura en hora de Ciudad de México y se guarda en UTC (`domain/time.ts`); no puede ser futura. Solo se asignan prompts activos (al editar se conserva el archivado que ya tenía). Respuesta de hasta 50 000 caracteres, guardada tal cual en `raw.text`. URLs citadas = la lista pegada (una por línea; se acepta texto alrededor de la URL) más las que aparecen dentro de la respuesta (texto plano o enlaces markdown), con su origen (`listed`/`answer`/`both`); se normalizan (http(s), host público, sin fragmento ni parámetros de seguimiento como `utm_*`), sin duplicados y hasta 100 por corrida. **Nunca se descargan**, así que no pasan por el cliente con protección SSRF. Cada URL va a `cited_domains` con su host sin `www.` y si es del sitio (dominio o subdominio). Son gratuitas (no pasan por R-003) y funcionan con el sitio pausado; anti-abuso: 200 corridas manuales por sitio en 24 h.

**R-052 Corridas automáticas**
- EL SISTEMA DEBE ejecutar cada prompt activo N veces (default 3, configurable) por motor habilitado, con la frecuencia configurada.
- Motores v1: los que tengan API oficial con búsqueda web; empezar con uno solo (Q3).
- EL SISTEMA DEBE guardar la respuesta cruda, las citas/fuentes devueltas, el modelo, los parámetros y el costo.
- *Diseño (M11, motor y adaptador)*: Q3 resuelta (§13): **ChatGPT por la Responses API de OpenAI** con su herramienta `web_search` (búsqueda nativa de OpenAI) y el modelo más barato con búsqueda, `gpt-6-luna`. Motores, tarifas y límites en `domain/geo/engines.ts` (`AUTO_ENGINES`; el modelo va en código porque su costo depende de tarifas conocidas); adaptadores detrás de `LlmProvider` en `src/providers/llm/`. La corrida se hace como la haría un usuario: solo el texto del prompt, sin instrucciones propias, el modelo decide si busca (`tool_choice: auto`), ubicación aproximada = la del prompt o la ciudad del sitio + su país, razonamiento `low`, `store: false`. Para acotar el costo: como mucho 3 búsquedas y 4 000 tokens de salida. `runAutoPrompt()` (src/server/geo-auto.ts) omite sin gastar si el motor no tiene key, el sitio está pausado (`siteForPaidWork()`) o el prompt archivado, y llama dentro de `withPaidCall()` reservando el costo máximo (búsquedas + tokens; ~$0.042) y registrando el real según el `usage` y las búsquedas cobradas (`tool_usage.web_search.num_requests`); medido: $0.011–0.012 por corrida con una búsqueda y ~$0.022 con dos. Si el proveedor rechaza la petición (4xx/5xx) se registra costo 0; una respuesta incompleta, lo que informa su `usage`; un corte de red conserva el estimado. Se guarda en `llm_runs` (`source = auto`, modo `web_search`, el modelo que respondió y `cost_usd`): `raw.text` con la respuesta y `raw.api` con parámetros, uso, citas con título, todas las fuentes consultadas y la respuesta completa de la API. Las citas (`url_citation`) cuentan como fuente y las URLs del texto como respuesta (misma normalización de R-051), y en la misma transacción se guardan `cited_domains` y las menciones (R-053). Errores: `auth` (key inválida), `quota` (sin saldo), `retryable` (429, 5xx, red) y `fatal`. La respuesta de la API se parece a la de chatgpt.com pero no es idéntica (otro modelo, sin personalización). `pnpm geo:run <dominio|id> [--prompt <id>]` hace una corrida desde la terminal (soporte; gasta créditos).
- *Diseño (M11, programación)*: GEO → **Automático** (`src/routes/_app/sitios/$siteId/geo/automatico.tsx`), ajustes por sitio en `geo_auto_settings` (sin fila = desactivado, porque cuesta créditos): activado, repeticiones por prompt de 1 a 5 (3 por defecto), frecuencia semanal (por defecto), quincenal o mensual y motores (solo los que tienen key). Periodos en hora de Ciudad de México (`domain/geo/auto.ts`): semana de lunes a domingo, bloques de dos semanas desde el lunes 2026-01-05 o mes calendario. Cada prompt **activo** se mide N veces por motor y periodo: `geo.schedule` (diario, 15:10 UTC = 9:10 en Ciudad de México, `missed: once`) encola `geo.run` por cada par prompt–motor de los sitios activados y activos al que le faltan corridas automáticas en el periodo; guardar los ajustes encola lo que falte sin esperar al cron. `geo.run` tiene política `exclusive` con `singletonKey` = sitio:prompt:motor (como mucho uno en cola o en curso) y concurrencia 2; al empezar recuenta lo que falta, así que un reintento, un job repetido o un cambio de ajustes no pasan de N. Un error de la API que no se arregla reintentando (key, saldo, respuesta incompleta) no se reintenta: queda en `last_error` como un motivo para el cliente sin detalles del proveedor (el detalle va al log) y lo que falta se intenta al día siguiente; los demás (429, 5xx, red) se reintentan con la política de la cola (R-071). Una corrida completada borra `last_error`. La pantalla muestra el periodo en curso (corridas hechas de las esperadas), el gasto del mes del sitio en esos proveedores (`spend_ledger`) y una estimación mensual (prompts activos × repeticiones × periodos al mes × costo medio medido, ~$0.017 por corrida), avisa si el sitio está pausado y explica que la respuesta de la API no es idéntica a la de la app. Métricas y Corridas filtran por **origen** (manuales o automáticas; todas por defecto).

**R-053 Extracción de menciones**
- Para cada respuesta, EL SISTEMA DEBE detectar: menciones de la marca (con alias), menciones de competidores, dominios citados y si cita el dominio propio.
- La detección DEBE ser primero determinista (coincidencia de alias/dominios); solo usar un LLM barato para desambiguar casos marcados como dudosos.
- *Diseño (M10)*: `domain/geo/mentions.ts`. Entidades: la marca (sus alias) y cada competidor (nombre + alias). Se busca cada término normalizado con `matchKey` (sin acentos ni mayúsculas) y con límites de palabra (letras y dígitos de cualquier idioma); las URLs del texto no cuentan como mención (`https://rosetta.com.mx` no es «Rosetta») y dos términos solapados de la misma entidad («Panadería Rosetta» y «Rosetta») cuentan una vez. Una coincidencia es **dudosa** si el término tiene ≤ 3 letras o si se configuró con mayúsculas y aparece todo en minúsculas («Bloom» → «bloom»); una entidad es dudosa si todas sus coincidencias lo son. Se guarda una fila por entidad y corrida en `mentions` (veces, dudosa, fragmento de ±90 caracteres y término). Revisión manual en el detalle de la corrida: confirmar o descartar (y deshacer); **una mención cuenta en las métricas si es segura o confirmada** (`mentionCounts`). La extracción corre en la misma transacción al crear o editar una corrida; al cambiar alias o crear/editar un competidor, el job `geo.extract` recalcula todas las corridas del sitio desde `raw` conservando la revisión de cada entidad (cola con política `stately` y `singletonKey` = sitio: varios cambios seguidos = una pasada). Borrar un competidor borra sus menciones (cascade). Dominios citados y cita del dominio propio: `cited_domains` (R-051). *Diseño (M11, T11.3)*: las dudosas que nadie ha revisado (`review = auto`, `reviewed_by` null) las decide un LLM barato (`gpt-6-luna` sin búsqueda, Structured Outputs con esquema estricto; `domain/geo/disambiguation.ts` y src/server/geo-disambiguate.ts): una llamada por corrida con el prompt, la ciudad, cada entidad dudosa (nombre, alias, dominios y el término que coincidió) y la respuesta completa (hasta 20 000 caracteres); devuelve por mención si se refiere a esa entidad y un motivo corto, que se guardan como `confirmed`/`rejected` con `reviewed_by = llm` y `review_reason`. Una id que no se preguntó o una respuesta inválida se ignoran (la mención sigue pendiente). Es de pago: `siteForPaidWork()` (con el sitio pausado quedan para la revisión manual) y `withPaidCall()` (~$0.00006 por corrida medido; se reserva la entrada estimada + toda la salida). Job `geo.disambiguate` (`stately`, `singletonKey` = sitio, 50 corridas por pasada y se vuelve a encolar si quedan) que se pide tras guardar una corrida manual con dudosas, tras `geo.run` con corridas nuevas y tras `geo.extract`. **La revisión de una persona manda**: confirmar, descartar o deshacer la marca con `reviewed_by = user` y el LLM ya no la toca; la actualización del LLM es condicional, así que tampoco pisa una revisión hecha mientras respondía. En el detalle de la corrida, «Confirmada/Descartada por IA» con el motivo y el botón para cambiarla. Recalcular menciones conserva revisión, revisor y motivo por entidad. Las revisiones anteriores a M11 se migraron como de una persona.

**R-054 Métricas GEO**
- EL SISTEMA DEBE calcular por prompt, motor y periodo: tasa de mención (% de corridas), tasa de cita del dominio, share of voice contra competidores y dominios fuente más citados.
- EL SISTEMA DEBE mostrar tamaño de muestra junto a cada métrica y NO DEBE mostrar "posición" como métrica GEO.
- *Diseño (M10)*: GEO → **Métricas** (primera subpestaña; lógica pura en `domain/geo/metrics.ts`, consulta en `src/server/geo-metrics.ts`). Unidad = corrida; solo cuentan menciones seguras o confirmadas (`mentionCounts`) y la cita propia sale de `cited_domains.own`. Tasa de mención = corridas que mencionan la marca / corridas; tasa de cita = corridas que citan una URL del sitio / corridas; **share of voice** = corridas que mencionan la marca / Σ corridas que mencionan cada entidad (marca + competidores), por entidad, solo si hay competidores; dominios fuente = los 15 dominios citados en más corridas, con la proporción de corridas que los citan. Todo en total, por motor y por prompt. Cada tasa lleva aciertos de n e intervalo de **Wilson al 95 %**, con aviso "muestra pequeña" si n < 5. Filtros (en la URL): periodo últimas 4 semanas (por defecto), 12 semanas (desde las 00:00 de hace 27/83 días hasta el final de hoy) o mes calendario, todo en hora de Ciudad de México; prompts **sin marca** (por defecto: la marca en la pregunta infla la mención), con marca o todos, indicando cuántas corridas hay del otro tipo; motor; prompts archivados fuera salvo que se incluyan. Se calcula al vuelo (sin tablas de agregados: a lo sumo 200 corridas manuales por sitio y día). Tablas y barras CSS (tasa en oscuro, intervalo como banda clara), sin librería de gráficas; nunca "posición".

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
| UI | Tailwind + componentes propios/shadcn | sin librería de gráficas: barras CSS y SVG propios (tendencia de auditoría, métricas GEO, tendencias de búsqueda) |
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
                locale, country, business_name, street_address, postal_code, region, phone,
                key_paths text[], status active|paused,
                verification_token, verified_at, verification_method dns|meta|staff,
                verification_failures, verification_checked_at, created_at, updated_at)
                -- único (organization_id, domain_key); business_json se añade cuando un módulo lo use
competitors    (id, site_id, name, name_key, aliases text[], domains text[], created_at, updated_at)
                -- único (site_id, name_key)
brand_aliases  (id, site_id, alias, alias_key, created_at)  -- único (site_id, alias_key)

collector_state (site_id, source gsc|bing|inspection, property, status pending|ok|no_access|error,
                oldest, newest, last_run_at, last_success_at, last_error, updated_at)
                -- pk (site_id, source); oldest–newest = tramo continuo importado
gsc_daily      (site_id, date, query, page, country, device, clicks, impressions, ctr, position)
                -- detalle; se reemplaza por (site_id, date); 16 meses
gsc_totals_daily (site_id, date, country, device, clicks, impressions, ctr, position)
                -- pk (site_id, date, country, device); agregado por propiedad
bing_daily     (site_id, date, query, clicks, impressions, avg_click_position,
                avg_impression_position)                -- pk (site_id, date, query)
bing_page_daily (site_id, date, page, clicks, impressions, avg_click_position,
                avg_impression_position)                -- pk (site_id, date, page)
bing_totals_daily (site_id, date, clicks, impressions)  -- pk (site_id, date)
index_status   (site_id, url, checked_at, verdict PASS|PARTIAL|FAIL|NEUTRAL|VERDICT_UNSPECIFIED,
                coverage_state, indexing_state, robots_txt_state, page_fetch_state,
                last_crawl_time, google_canonical, user_canonical, crawled_as)
                -- pk (site_id, url, checked_at); 12 semanas
inspection_quota (property, day, used)                   -- pk (property, day); día del Pacífico

bot_hits       (id, ts, host, path, status, bytes, ua, ip inet, bot,
                verified verified|failed|unverified)   -- solo bots; por host; 90 días
bot_daily      (host_key, date, bot, verified, hits, errors_4xx, errors_5xx)
                -- pk (host_key, date, bot, verified); día de Ciudad de México; indefinido
log_cursors    (file, inode, inode_since, offset, draining, updated_at)
                -- pk file (archivo activo); draining = rotado que se está terminando
bot_rules      (id, pattern, kind bot|ignore, name, owner, category, created_by, created_at)
                -- único lower(pattern); reglas de staff tras el catálogo de domain/bots.ts
ip_verifications (ip inet, bot, verified, method, hostname, checked_at, expires_at)
                -- pk (ip, bot); caché del DNS inverso + directo
bot_range_sources (source, url, prefixes, fetched_at, last_error, updated_at)
bot_ip_ranges  (source, prefix inet)                     -- pk (source, prefix); índice gist

audits         (id, site_id, trigger scheduled|manual, status queued|running|done|failed,
                requested_by, created_at, started_at, finished_at, score, summary jsonb, error)
                -- único (site_id) donde status en queued|running
audit_pages    (id, audit_id, url, final_url, status, content_type, bytes, ms, error, facts jsonb)
audit_findings (id, audit_id, url, rule, severity error|warning|notice, detail jsonb)
psi_results    (id, audit_id, site_id, url, strategy mobile|desktop, lab jsonb, field jsonb,
                lighthouse_version, error, fetched_at)

keywords       (id, site_id, text, location, lat, lng, device, locale, group, priority)
serp_snapshots (id, keyword_id, provider, fetched_at, raw jsonb, cost_usd)
rank_results   (snapshot_id, organic_pos, url, local_pack, local_pos, ai_overview, ai_cited)
grid_runs      (id, keyword_id, size, spacing_m, fetched_at, cost_usd)
grid_points    (run_id, row, col, lat, lng, position)

prompts        (id, site_id, text, text_key, intent category|evaluation|decision, branded, locale,
                location, active, created_at, updated_at)       -- único (site_id, text_key)
llm_runs       (id, prompt_id, site_id, engine, mode, model, source manual|auto, run_at,
                raw jsonb, citations jsonb, cost_usd, notes, created_by, created_at, updated_at)
mentions       (id, run_id, entity_type brand|competitor, competitor_id, match_count, ambiguous,
                review auto|confirmed|rejected, reviewed_by user|llm, review_reason, snippet, term,
                extracted_at)
                -- único (run_id, entity_type, competitor_id) nulls not distinct; la cita propia
                -- vive en cited_domains.own
cited_domains  (run_id, url, domain, own)                    -- pk (run_id, url)
geo_auto_settings (site_id, enabled, repetitions, frequency weekly|biweekly|monthly, engines text[],
                last_error, last_error_at, updated_by, created_at, updated_at)  -- pk site_id (R-052)

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
- [x] T6.0 Verificación de propiedad del sitio (DNS TXT o meta tag) antes de importar datos.
- [x] T6.1 Service account + cliente GSC + job diario idempotente.
- [x] T6.2 Cliente Bing + job diario.
- [x] T6.3 Resolver Q1/Q2 e importar datos de IA si existen (no existen por API: ver §13).
- [x] T6.4 Job semanal de URL Inspection con respeto de cuota.
- [x] T6.5 Vistas del dashboard: tendencias por sitio.

### M7 — Bots (R-020–R-023)
- [x] T7.1 Montaje ro de logs + lector incremental con cursor.
- [x] T7.2 Clasificador de user-agents (tabla configurable).
- [x] T7.3 Verificación: rangos publicados + DNS inverso con caché.
- [x] T7.4 Agregados diarios, retención y vista de bots de IA.

### M8 — Auditor (R-030–R-034)
- [x] T8.1 Fetch sin JS (cliente HTTP con protección SSRF) + sitemaps + reglas on-page + job semanal en ventana + auditoría manual + vista por sitio.
- [x] T8.2 Diff contra DOM de Playwright (tráfico del navegador por el cliente con protección SSRF).
- [x] T8.3 Extracción y validación de JSON-LD (vocabulario de schema.org versionado) + datos del negocio en el sitio y chequeo de nombre, dirección y teléfono.
- [x] T8.4 robots.txt público por bot (rutas clave del sitio) + validación de sitemap + enlaces rotos.
- [x] T8.5 PageSpeed Insights API (lab + CrUX) para las rutas clave, móvil y escritorio.
- [x] T8.6 Score de salud, diff entre auditorías, tendencia y alerta de JSON-LD roto.

### M9 — Rank tracking (R-040–R-043)
- [ ] T9.1 `SerpProvider` + adaptador Serper.
- [ ] T9.2 Keywords CRUD + job semanal + parser de features del SERP.
- [ ] T9.3 Resolver Q4 + geo-grid + heatmap.

### M10 — GEO manual (R-050, R-051, R-053, R-054)
- [x] T10.1 CRUD de prompts, competidores y alias.
- [x] T10.2 Formulario de corrida manual.
- [x] T10.3 Extractor determinista de menciones y dominios citados.
- [x] T10.4 Métricas con tamaño de muestra.

### M11 — GEO automático (R-052)
- [x] T11.1 `LlmProvider` + primer adaptador (motor elegido en Q3).
- [x] T11.2 Job con N repeticiones + registro de costo + topes.
- [x] T11.3 Desambiguación con LLM barato solo para casos dudosos.
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
- Datos de IA de Search Console y Bing (Q1/Q2) en `gsc_ai_daily` y `bing_ai_daily` cuando sus APIs los expongan; revisar sus referencias al planificar M12.

---

## 11. Presupuesto de costos

| Etapa | Proveedores | Costo mensual extra |
|---|---|---|
| M1–M5 | Resend (free tier: 3,000 correos/mes) | $0 |
| M6–M8 | GSC, Bing, PageSpeed, logs propios | $0 |
| M9–M10 | Serper (tier gratis inicial) | $0 |
| M11 | 1 motor de LLM por uso (ChatGPT: $0.011–0.022 por corrida según las búsquedas; 20 prompts × 3 semanales ≈ $4.50/mes por sitio) | ~$5–20 |
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

- **Q4** (T9.3) ¿Serper permite búsquedas de Maps con coordenadas exactas para el geo-grid, o hace falta otro proveedor?
- **Q6** (M5) Dominio del servicio. No se necesita hasta el deploy; en desarrollo se usa `localhost` y Mailpit.

**Resueltas**
- **Q3** → OpenAI (M11, 2026-10-13): Responses API + `web_search` con `gpt-6-luna` ($10 por 1 000 búsquedas + tokens; ~$0.012 por corrida medida). ChatGPT es el motor más relevante para los clientes y los términos de OpenAI dan al cliente la propiedad del output. **Descartados**: Gemini con Grounding with Google Search (sus términos prohíben «analyze» los resultados y exigen mostrar las Search Suggestions al usuario que hizo la pregunta; además el tier gratuito ya no incluye búsqueda) y Grounding with Bing (prohíbe almacenar el output; no es Copilot). Pasarelas (OpenRouter, Vercel) descartadas: pueden sustituir la búsqueda nativa por otra (Exa) y suman términos. Sin scraping de apps de consumo (§1.2). Segundo motor (T11.4): Perplexity solo si su API responde con un modelo propio (la API de Sonar se retiró el 2026-09-27 y su preset barato usa un modelo de OpenAI); si no, Claude.
- **Q1** → No (M6, 2026-10-12). El informe de IA generativa de Search Console (AI Overviews, AI Mode y Discover; solo impresiones) existe desde el 3 de junio de 2026 únicamente en la interfaz: la referencia de `searchanalytics.query` (actualizada el 2026-08-11) no tiene `type` ni dimensión para él.
- **Q2** → No (M6, 2026-10-12). AI Performance de Bing Webmaster Tools (citas, páginas citadas, grounding queries, citation share; en vista previa) es solo de la interfaz: la API no tiene métodos para esos datos.
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
