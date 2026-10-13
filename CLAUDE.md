# ags-io — guía para Claude Code

Servicio B2C autohospedado de SEO / GEO / AEO. **SPEC.md es la fuente de verdad**: requisitos (R-XXX), diseño, modelo de datos y plan por módulos (§10). Este archivo resume cómo trabajar y **en qué estado está el proyecto**; se actualiza al cerrar cada módulo.

## "Empieza módulo Mx"

Cuando el usuario pida empezar un módulo:

1. Lee **SPEC.md completo**, la sección [Estado](#estado) de este archivo y `git log --oneline -20`.
2. Comprueba que el módulo anterior esté aprobado (tabla de Estado). Si no lo está, dilo y no empieces.
3. Antes de escribir código, entrega:
   - resumen del módulo tal como lo entiendes;
   - contradicciones o huecos del spec que lo afecten, con tu propuesta para cada uno;
   - credenciales o accesos que necesitas del usuario (y cuáles ya existen; ver Estado);
   - plan de commits (uno por tarea T<m>.<n>).
4. **Espera su visto bueno** y luego implementa tarea por tarea con el skill `/ship-task`.

## Reglas

- Trabajo por módulos: solo lo del módulo en curso. Funcionalidad final y robusta, **nada de MVP**.
- Al cerrar un módulo: guion e2e manual (pasos + resultado esperado + casos negativos + limpieza) y **no empezar el siguiente sin aprobación explícita**.
- **Sin unit tests.** Se verifica con `pnpm check` (typecheck + lint + format + build) y verificación manual real, documentada en el commit (`Verificación:`). Nunca afirmes una verificación que no corriste.
- Consulta la documentación actual de cada librería o API antes de usarla; no asumas APIs de memoria.
- Si cambia una decisión de diseño, actualiza SPEC.md en el mismo commit. Marca `[x]` la tarea en §10 al terminarla.
- Commits con el formato de `/ship-task` (commitlint lo valida). Nunca `--no-verify`.
- TypeScript estricto, pnpm, un solo package. `domain/` es lógica pura: no importa `providers/`, `db/`, `server/` ni frameworks (ESLint lo impide).
- Multi-tenencia: toda server function de datos de negocio pasa por `organizationMiddleware` y filtra por `organizationId`; un recurso ajeno responde "no encontrado".
- Todo job de pago usa `siteForPaidWork()` y `withPaidCall()` (SPEC R-002, R-003).
- Todo lo que descargue URLs de clientes pasa por `src/audit/http.ts` (protección SSRF).
- Comentarios, textos de UI y commits en español.

## Entorno local

- Stack en Docker: `docker compose up -d --build` (postgres, web, worker, mailpit). App en http://localhost:3000, Mailpit en http://localhost:8025.
- Si `docker` se cuelga en esta Mac: `DOCKER_CONFIG` temporal con `{}` y `DOCKER_HOST=unix://$HOME/.docker/run/docker.sock` (detalle en la memoria de Claude).
- `localhost:3000` puede estar ocupado por otro proyecto del usuario (p. ej. `crucigrama` con Vite en `[::1]:3000`); Chrome resuelve a ese. Compruébalo con `lsof -nP -iTCP:3000 -sTCP:LISTEN` y avisa; no lo mates.
- Migraciones: `pnpm db:generate --name <nombre>` y `pnpm db:migrate` (el contenedor `web` también migra al arrancar).
- Scripts útiles: `pnpm staff:create`, `pnpm spend:demo`, `pnpm audit:run <dominio|id> [--inline]`, `pnpm site:verify <dominio|id> [--staff|--clear]`, `pnpm bots:sample [--host H] [--rotate]`, `pnpm schemaorg:update` (ver README).
- **Usuarios del usuario**: `staff@test.com` (staff con 2FA) y `test@test.com`. No los borres ni crees datos en sus cuentas. Para probar, crea usuarios/organizaciones temporales (p. ej. `*@example.test`) y bórralos al terminar.
- Para e2e de staff con un staff temporal: `STAFF_PASSWORD=… pnpm staff:create --email …@example.test`, login por `POST /api/auth/sign-in/email`, 2FA con `POST /api/auth/two-factor/enable` + `verify-totp` (TOTP calculado del `totpURI`) y la cookie con curl: Chrome suele tener abierta la sesión del usuario y no se toca.
- Para e2e en Chrome con usuario temporal: registro por `POST /api/auth/sign-up/email`, verificación con el enlace de Mailpit (`/api/v1/search`), y `form_input` para los formularios.

## Estado

_Actualizado al cerrar M7 (2026-10-13), pendiente del e2e del usuario._

| Módulo | Estado | Notas |
|---|---|---|
| M0 Preparación de la VPS | Hecho salvo T0.8 | T0.8 (build de Vesti en CI) pendiente, fuera de ags-io |
| M1 Base | ✅ Aprobado | |
| M2 Cuentas | ✅ Aprobado | |
| M3 Sitios | ✅ Aprobado | |
| M4 Gasto y operación | ✅ Aprobado | |
| M5 Deploy y respaldos | ⏸ Bloqueado | Falta el dominio (Q6) y acceso SSH a la VPS |
| M6 Colectores | ✅ Aprobado | T6.0 (verificación de propiedad) añadida al plan |
| M8 Auditor | ✅ Aprobado | Adelantado a M5–M7 porque no depende del dominio |
| M10 GEO manual | ✅ Aprobado | |
| M7 Bots | 🧪 Listo para e2e | Probado con logs de muestra; la prueba con logs reales de la VPS queda para M5 |
| M9, M11, M12 | Pendientes | |

**Siguiente recomendado** (tras aprobar M7): **M11 GEO automático** (requiere decidir Q3 y una API key; M10 ya está). Alternativas: M9 Rank tracking (API key de Serper y Q4) o M12 Reportes y alertas (bot de Telegram). Con M7 se cierra el hito piloto M0–M8 salvo M5, que sigue bloqueado por el dominio.

Hallazgos de M7 útiles para quien siga:

- **Los datos de bots van por host, no por sitio**, y solo los ve un sitio **verificado** de ese dominio. Por eso `pnpm bots:sample` usa por defecto `bots.example.test`: con `--host chrisrm.dev` los datos falsos aparecen en el sitio verificado de test@test.com.
- Logs: el worker monta `/var/log/caddy` en solo lectura (dev: `.dev/caddy-logs`; VPS: `CADDY_LOG_HOST_DIR`). **En la VPS falta comprobar** la ruta y los nombres reales de los logs de T0.7, que el usuario `node` del contenedor pueda leerlos (permisos) y la versión de Caddy (formato del nombre de los rotados). Va con T5.4.
- Verificación: listas de Google, Bing, Apple, OpenAI, Anthropic (`claude.com/crawling/bots.json`) y Perplexity, más DNS inverso + directo para Googlebot, Bingbot y Applebot. La lista de Bing responde 500 a un user-agent con acentos (se usa uno ASCII).
- Staff → Bots: estado de la ingesta, listas de IPs, reglas propias y catálogo. Las alertas `bot_errors` se registran en `alerts` (Telegram en M12).

Hallazgos de M6 útiles para quien siga:

- **Sin verificar la propiedad del dominio (T6.0) no se importa nada** de GSC ni Bing: la service account y la key son de la plataforma. Soporte: `pnpm site:verify <dominio|id> [--staff|--clear]`.
- chrisrm.dev aún no tiene datos en GSC ni en Bing (propiedad nueva; en el e2e ambas APIs respondieron bien con 0 filas y URL Inspection dio la portada como indexada) y **no tiene robots.txt ni sitemap** (404): URL Inspection solo revisa la portada. La inserción de filas reales y la granularidad de fechas de Bing quedan por confirmar cuando haya datos.
- URL Inspection responde 403 tanto sin acceso como para una URL que no considera de la propiedad; `src/server/inspection.ts` reconsulta la propiedad para distinguirlo.
- Bing acepta la URL del sitio con o sin `www.` y con http o https.
- La carga inicial de GSC (16 meses) tarda ~5 min por sitio (21 pasadas de ~12 s).
- Hallazgos anteriores: un script `tsx` que encola por pg-boss no termina solo (`process.exit(0)`); en Chrome, `form_input` sobre un checkbox de React no dispara `onChange` (usa un clic); las métricas GEO se calculan al vuelo sobre `llm_runs`.

Qué necesita cada pendiente:

- **M9 Rank tracking**: API key de Serper; resolver Q4.
- **M11 GEO automático**: API key del motor elegido en Q3; requiere M10.
- **M12 Reportes y alertas**: bot de Telegram (token + chat id). Las alertas ya se registran en `alerts` (`spend_cap`, `jsonld_broken`, `site_unverified`, `bot_errors`).

**Credenciales ya configuradas** (en `.env`, nunca en el repo): `PAGESPEED_API_KEY`, `BING_WEBMASTER_API_KEY`, `GOOGLE_SERVICE_ACCOUNT_KEY` (base64 de `~/.config/ags-io/google-service-account.json`, que sigue fuera del repo). `BING_ACCOUNT_EMAIL` (`avebaphomet66@gmail.com`, la cuenta de Bing Webmaster dueña de la key; los clientes la ven en Ajustes). **Al tener el dominio (Q6)**, cambiar Bing a una cuenta dedicada del servicio (nueva key + email + chrisrm.dev en esa cuenta) y valorar lo mismo para la service account de Google.

**Accesos de los colectores**:

- Search Console: `sc-domain:chrisrm.dev` verificada por DNS en Porkbun (el TXT no se borra); la service account `ags-io-gsc@ags-io.iam.gserviceaccount.com` (proyecto `ags-io`) tiene permiso Restringido y funciona (searchanalytics y URL Inspection probados).
- Bing Webmaster Tools: `https://chrisrm.dev/` verificado en la cuenta de la key.
- El DNS de chrisrm.dev está en Porkbun (nameservers `*.ns.porkbun.com`), no en Cloudflare.

**Sitio piloto**: chrisrm.dev (cuenta test@test.com). Sitios públicos útiles para probar: vite.dev (SSR, 57 URLs), excalidraw.com (contenido solo con JS), levainbakery.com (Shopify, pesado).

**Pendientes y decisiones abiertas**: Q3, Q4 y Q6 en SPEC §13 (Q1/Q2 resueltas en M6: no hay API de datos de IA). Medir la memoria real del worker en la VPS en T5.4 (en Docker local el pico fue ~800 MiB de 1 GiB con un sitio Shopify grande).

## Al cerrar un módulo (además de `/ship-task`)

1. Actualiza la sección **Estado** de este archivo: módulo "Listo para e2e", siguiente recomendado, credenciales nuevas en `.env`, pendientes y hallazgos que deba conocer quien siga.
2. Entrega el guion e2e y espera la aprobación.
3. Cuando el usuario apruebe: marca el módulo ✅ Aprobado en la tabla, ajusta "Siguiente recomendado" y haz commit (`docs(repo): estado tras aprobar M<n>`). Así una sesión nueva puede arrancar el siguiente módulo solo con "empieza módulo M<n>".
