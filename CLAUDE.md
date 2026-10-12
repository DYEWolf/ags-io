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
- Scripts útiles: `pnpm staff:create`, `pnpm spend:demo`, `pnpm audit:run <dominio|id> [--inline]`, `pnpm schemaorg:update` (ver README).
- **Usuarios del usuario**: `staff@test.com` (staff con 2FA) y `test@test.com`. No los borres ni crees datos en sus cuentas. Para probar, crea usuarios/organizaciones temporales (p. ej. `*@example.test`) y bórralos al terminar.
- Para e2e en Chrome con usuario temporal: registro por `POST /api/auth/sign-up/email`, verificación con el enlace de Mailpit (`/api/v1/search`), y `form_input` para los formularios.

## Estado

_Actualizado al aprobar M8 (2026-10-12)._

| Módulo | Estado | Notas |
|---|---|---|
| M0 Preparación de la VPS | Hecho salvo T0.8 | T0.8 (build de Vesti en CI) pendiente, fuera de ags-io |
| M1 Base | ✅ Aprobado | |
| M2 Cuentas | ✅ Aprobado | |
| M3 Sitios | ✅ Aprobado | |
| M4 Gasto y operación | ✅ Aprobado | |
| M5 Deploy y respaldos | ⏸ Bloqueado | Falta el dominio (Q6) y acceso SSH a la VPS |
| M8 Auditor | ✅ Aprobado | Adelantado a M5–M7 porque no depende del dominio |
| M6, M7, M9–M12 | Pendientes | |

**Siguiente recomendado: M10 GEO manual** (no necesita credenciales). Qué necesita cada pendiente:

- **M6 Colectores**: service account de Google con acceso a la propiedad de Search Console del sitio de prueba (chrisrm.dev), sitio verificado en Bing Webmaster Tools + API key; resolver Q1/Q2 (¿datos de IA por API?).
- **M7 Bots**: logs de Caddy de la VPS para la verificación real (se puede desarrollar con logs de muestra).
- **M9 Rank tracking**: API key de Serper; resolver Q4.
- **M10 GEO manual**: nada.
- **M11 GEO automático**: API key del motor elegido en Q3; requiere M10.
- **M12 Reportes y alertas**: bot de Telegram (token + chat id). Las alertas ya se registran en `alerts` (`spend_cap`, `jsonld_broken`).

**Credenciales ya configuradas** (en `.env`, nunca en el repo): `PAGESPEED_API_KEY`.

**Sitio piloto**: chrisrm.dev (cuenta test@test.com). Sitios públicos útiles para probar: vite.dev (SSR, 57 URLs), excalidraw.com (contenido solo con JS), levainbakery.com (Shopify, pesado).

**Pendientes y decisiones abiertas**: Q1–Q4 y Q6 en SPEC §13. Medir la memoria real del worker en la VPS en T5.4 (en Docker local el pico fue ~800 MiB de 1 GiB con un sitio Shopify grande).

## Al cerrar un módulo (además de `/ship-task`)

1. Actualiza la sección **Estado** de este archivo: módulo "Listo para e2e", siguiente recomendado, credenciales nuevas en `.env`, pendientes y hallazgos que deba conocer quien siga.
2. Entrega el guion e2e y espera la aprobación.
3. Cuando el usuario apruebe: marca el módulo ✅ Aprobado en la tabla, ajusta "Siguiente recomendado" y haz commit (`docs(repo): estado tras aprobar M<n>`). Así una sesión nueva puede arrancar el siguiente módulo solo con "empieza módulo M<n>".
