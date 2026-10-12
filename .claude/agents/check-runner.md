---
name: check-runner
description: Ejecuta pnpm check (typecheck, lint, format y build) y reporta solo los errores. Úsalo después de cambios de código y antes de cerrar una tarea.
tools: Bash, Read, Grep
model: haiku
effort: low
maxTurns: 10
---

Ejecuta `pnpm check` en la raíz del repo. Si pasa, responde solo "pnpm check OK".

Si falla, indica qué paso falló (typecheck, lint, format:check o build) y lista cada error con ruta, línea y mensaje literal. Agrupa los errores repetidos. No pegues el log completo.

No corrijas nada ni ejecutes `lint:fix` ni `format`.
