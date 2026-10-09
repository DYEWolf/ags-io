# ags-io

Servicio autohospedado de SEO, GEO y AEO para negocios. La fuente de verdad del proyecto es [SPEC.md](SPEC.md).

## Requisitos

- Node 22.18+ (ver `.nvmrc`) y pnpm 12 (`packageManager` en `package.json`)
- Docker con Compose v2

## Puesta en marcha (desarrollo)

```sh
pnpm install                 # instala dependencias y los git hooks (lefthook)
cp .env.example .env         # cambia POSTGRES_PASSWORD (y en DATABASE_URL) y genera BETTER_AUTH_SECRET
chmod 600 .env

docker compose up -d postgres mailpit
pnpm dev                     # aplica migraciones y levanta la app en http://localhost:3000
pnpm dev:worker              # en otra terminal: worker con recarga
```

Mailpit (bandeja de correos de desarrollo): http://localhost:8025. Los correos los envía el
worker, así que para registrarte o recuperar la contraseña tiene que estar corriendo.

### Primer usuario staff

```sh
pnpm staff:create --email tu@correo --name "Tu nombre"                               # local
docker compose exec -it web node dist/node/create-staff.mjs --email tu@correo --name "…"  # contenedor
```

Al entrar, activa la verificación en dos pasos (Cuenta → Seguridad): el panel de staff la exige.

### Stack completo en contenedores

```sh
docker compose up -d --build --wait
curl localhost:3000/healthz
```

`web` aplica las migraciones al arrancar; `worker` espera a que `web` esté sano.

## Comandos

| Comando | Qué hace |
|---|---|
| `pnpm check` | typecheck + lint + formato + build (lo exige `pre-push`) |
| `pnpm db:generate --name <nombre>` | genera una migración a partir de `src/db/schema` |
| `pnpm db:migrate` | aplica migraciones pendientes |
| `pnpm db:studio` | Drizzle Studio |
| `pnpm auth:check` | valida `src/db/schema/auth.ts` contra la config de Better Auth (tras cambiar plugins) |
| `pnpm staff:create` | crea el primer staff (o `--promote` a un usuario existente) |
| `pnpm build` / `pnpm start` / `pnpm start:worker` | build y ejecución de producción |

## Convenciones

- Commits: `tipo(M<n>): resumen [R-XXX]` (Conventional Commits, validado por commitlint). Scopes: `M0`…`M12`, `spec`, `deps`, `repo`, `ci`.
- No hay unit tests: cada tarea se verifica con `pnpm check` y verificación manual documentada; cada módulo, con un e2e manual aprobado (SPEC §0, §14).
- `src/domain/` es lógica pura: no importa `providers/`, `db/` ni frameworks (lo hace cumplir ESLint).
- Todo se guarda en UTC; se muestra en America/Mexico_City.

## Producción

```sh
AGS_IMAGE=ghcr.io/<owner>/ags-io:<tag> \
  docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

El pipeline CI → GHCR → deploy llega en el módulo M5.
