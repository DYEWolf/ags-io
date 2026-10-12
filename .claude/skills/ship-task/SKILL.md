---
name: ship-task
description: Cierra una tarea (T<m>.<n>) o un módulo (M<n>) de ags-io siguiendo SPEC.md - verifica con pnpm check, marca el checkbox en §10, sincroniza el spec, hace el commit con formato convencional y, al cerrar un módulo, entrega el guion de e2e manual. Úsala al terminar cada tarea o módulo, o cuando el usuario pida "commitea", "cierra la tarea" o "abre el PR".
---

# /ship-task — cierre de tarea o módulo en ags-io

SPEC.md es la fuente de verdad. Sigue los pasos en orden; si uno falla, corrige y vuelve a empezar desde ese paso.

## 1. Alcance

- Identifica la tarea (`T<m>.<n>`) y su módulo (`M<m>`) en SPEC.md §10, y los requisitos `R-XXX` que cubre.
- Revisa `git status` y `git diff`: todo lo que entra al commit debe pertenecer a esa tarea. Si hay cambios ajenos, sepáralos o pregunta.
- No entra código de módulos posteriores aunque parezca trivial.

## 2. Verificación

- Ejecuta `pnpm check` (typecheck + lint + format:check + build). Debe pasar completo.
- No hay unit tests en este proyecto. Lo que la verificación estática no cubre (comportamiento en runtime, Docker, migraciones, emails) se verifica a mano y se documenta en el mensaje del commit, sección `Verificación:`, con los comandos ejecutados y su resultado real. Nunca afirmes una verificación que no corriste.

## 3. Spec

- Marca `- [x]` la tarea en SPEC.md §10.
- Si cambió una decisión de diseño (stack, esquema, estructura, requisitos), actualiza la sección correspondiente del spec **en el mismo commit**.
- No marques el módulo como aprobado: eso solo lo hace el admin tras su e2e.

## 4. Commit

Formato (lo valida commitlint):

```
<tipo>(<scope>): <resumen en minúsculas, imperativo, ≤ 100 caracteres en total> [R-XXX]

T<m>.<n>. Qué cambia y por qué (no cómo; eso está en el diff).

Verificación:
- pnpm check ✔
- <verificación manual ejecutada y resultado>

Co-Authored-By: ...
```

- `tipo`: feat, fix, refactor, chore, docs, build, ci, perf, style, test, revert.
- `scope`: el módulo (`M0`…`M12`) o un área transversal (`spec`, `deps`, `repo`, `ci`).
- Un commit por tarea como regla. Divide solo si la tarea mezcla cambios independientes.
- Nunca uses `--no-verify`. Si lefthook falla, corrige la causa.

## 5. Cierre de módulo (solo con la última tarea del módulo)

Entrega al admin un **guion de e2e manual**:

- Requisitos previos (servicios a levantar, variables de `.env`).
- Pasos numerados, cada uno con su **resultado esperado** observable.
- Casos negativos (qué debe fallar y cómo).
- Cómo volver a un estado limpio.

Antes de entregarlo, actualiza la sección **Estado** de `CLAUDE.md` (módulo "Listo para e2e", siguiente recomendado, credenciales nuevas, pendientes) e inclúyelo en el commit.

Después espera la aprobación explícita del admin. No empieces el siguiente módulo sin ella. Cuando apruebe, marca el módulo ✅ en la tabla de Estado de `CLAUDE.md`, ajusta "Siguiente recomendado" y haz commit `docs(repo): estado tras aprobar M<n>`: una sesión nueva debe poder arrancar el siguiente módulo solo con "empieza módulo M<n>".

## 6. Pull request (cuando el admin lo pida o el flujo use ramas)

- Rama `m<n>/<slug>`. Título igual al formato del commit principal.
- Cuerpo según `.github/pull_request_template.md`, con el guion de e2e si cierra un módulo.
