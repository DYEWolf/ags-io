// Ingesta incremental de los access logs JSON de Caddy (R-020). Cada archivo activo tiene un
// cursor (inode + offset) en `log_cursors`; los hits de bots y el avance del cursor se guardan en
// la misma transacción, así que un reintento o una caída nunca duplican ni pierden líneas.
import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createGunzip } from 'node:zlib'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '~/db/client'
import { botHits, logCursors } from '~/db/schema'
import { createClassifier } from '~/domain/bots'
import {
  isActiveLogName,
  MAX_LINE_BYTES,
  parseAccessLine,
  parseRotatedName,
  type RotatedName,
} from '~/domain/logs'
import type { Logger } from '~/lib/logger'
import { loadBotRules } from '~/server/bots'
import { verificationsFor } from '~/bots/verify'

/** Bytes de log que lee una pasada como máximo (acota tiempo y memoria; el resto, otra pasada). */
const PASS_BYTES = 50 * 1024 * 1024
/** Hits por transacción. */
const BATCH_HITS = 1_000
/** También se guarda el cursor cada tanto aunque no haya bots (tráfico de personas). */
const BATCH_BYTES = 8 * 1024 * 1024
const NEWLINE = 0x0a

type Cursor = typeof logCursors.$inferSelect
type NewHit = typeof botHits.$inferInsert

export interface IngestResult {
  files: number
  bytes: number
  lines: number
  hits: number
  /** Líneas que no son peticiones del access log o les faltan datos. */
  invalid: number
  /** Quedó log sin leer por el tope de la pasada. */
  more: boolean
  /** Instantes del hit más antiguo y más reciente guardados (días a reagregar). */
  oldest: Date | null
  newest: Date | null
}

/** Otra pasada avanzó el mismo cursor: esta se detiene sin guardar nada. */
class CursorMoved extends Error {}

interface Pass {
  dir: string
  classify: (ua: string) => string | null
  log: Logger
  budget: number
  result: IngestResult
}

/** Lee lo nuevo de todos los logs del directorio. Lanza en errores de DB (el job se reintenta). */
export async function ingestLogs(dir: string, log: Logger): Promise<IngestResult> {
  const result: IngestResult = {
    files: 0,
    bytes: 0,
    lines: 0,
    hits: 0,
    invalid: 0,
    more: false,
    oldest: null,
    newest: null,
  }
  let names: string[]
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    names = entries.filter((entry) => entry.isFile()).map((entry) => entry.name)
  } catch (error) {
    log.warn({ dir, err: error }, 'no se puede leer el directorio de logs de Caddy')
    return result
  }

  const rotated = new Map<string, RotatedName[]>()
  for (const name of names) {
    const parsed = parseRotatedName(name)
    if (!parsed) continue
    const list = rotated.get(parsed.active) ?? []
    // El mismo rotado puede verse dos veces (sin comprimir y ya comprimido): una sola entrada.
    if (!list.some((item) => item.base === parsed.base)) list.push(parsed)
    rotated.set(parsed.active, list)
  }
  for (const list of rotated.values()) {
    list.sort((a, b) => a.rotatedAt.getTime() - b.rotatedAt.getTime())
  }

  // Reglas de staff leídas una vez por pasada.
  const classify = createClassifier(await loadBotRules())
  const pass: Pass = { dir, classify, log, budget: PASS_BYTES, result }
  for (const name of names.filter(isActiveLogName).sort()) {
    if (pass.budget <= 0) {
      result.more = true
      break
    }
    result.files += 1
    try {
      await ingestFile(pass, name, rotated.get(name) ?? [], new Set(names))
    } catch (error) {
      if (error instanceof CursorMoved) {
        log.warn({ file: name }, 'otra pasada avanzó el cursor: se omite el archivo')
        continue
      }
      throw error
    }
  }
  return result
}

async function getCursor(file: string, inode: string): Promise<Cursor> {
  await db.insert(logCursors).values({ file, inode, offset: 0 }).onConflictDoNothing()
  const [cursor] = await db.select().from(logCursors).where(eq(logCursors.file, file))
  if (!cursor) throw new Error(`cursor de ${file} no encontrado`)
  return cursor
}

/** Cambia el cursor solo si sigue como lo leímos; devuelve el nuevo. */
async function moveCursor(
  executor: Pick<typeof db, 'update'>,
  cursor: Cursor,
  next: Partial<Pick<Cursor, 'inode' | 'inodeSince' | 'offset' | 'draining'>>,
): Promise<Cursor> {
  const [updated] = await executor
    .update(logCursors)
    .set(next)
    .where(
      and(
        eq(logCursors.file, cursor.file),
        eq(logCursors.inode, cursor.inode),
        eq(logCursors.offset, cursor.offset),
        cursor.draining === null
          ? isNull(logCursors.draining)
          : eq(logCursors.draining, cursor.draining),
      ),
    )
    .returning()
  if (!updated) throw new CursorMoved()
  return updated
}

async function ingestFile(
  pass: Pass,
  name: string,
  rotated: RotatedName[],
  present: Set<string>,
): Promise<void> {
  const path = join(pass.dir, name)
  const info = await stat(path, { bigint: true })
  const inode = info.ino.toString()
  const size = Number(info.size)
  let cursor = await getCursor(name, inode)

  // Pasos acotados: terminar rotados pendientes y, al final, leer el archivo activo.
  for (let step = 0; step < rotated.length + 2; step += 1) {
    if (cursor.draining) {
      const current = rotated.find((item) => item.base === cursor.draining)
      const source = current ? sourceOf(pass.dir, current, present) : null
      if (source) {
        // Del .gz no se sabe el tamaño descomprimido sin leerlo: el límite lo pone el presupuesto.
        const available = source.gzip
          ? Number.POSITIVE_INFINITY
          : Number((await stat(source.path, { bigint: true })).size) - cursor.offset
        const done = await readInto(pass, cursor, source, available, true)
        cursor = done.cursor
        if (!done.eof) {
          pass.result.more = true
          return
        }
      } else {
        pass.log.warn({ file: name, rotated: cursor.draining }, 'el log rotado ya no existe')
      }
      // Siguiente rotado posterior o, si no hay, el archivo activo desde el principio.
      const after = current?.rotatedAt.getTime() ?? Number.NEGATIVE_INFINITY
      const next = rotated.find((item) => item.rotatedAt.getTime() > after)
      cursor = await moveCursor(
        db,
        cursor,
        next
          ? { draining: next.base, offset: 0 }
          : { draining: null, inode, inodeSince: new Date(), offset: 0 },
      )
      continue
    }

    if (cursor.inode !== inode) {
      // Caddy rotó el archivo: lo que faltaba del anterior está en el primer rotado posterior al
      // momento en que empezamos a seguir ese inode (los anteriores ya se leyeron). Si el rotado
      // aún no está comprimido, se reconoce por su inode.
      const since = cursor.inodeSince.getTime()
      const later = rotated.filter((item) => item.rotatedAt.getTime() > since)
      let first: RotatedName | undefined
      for (const item of later) {
        if (!present.has(item.base)) continue
        const info = await stat(join(pass.dir, item.base), { bigint: true }).catch(() => null)
        if (info?.ino.toString() === cursor.inode) {
          first = item
          break
        }
      }
      first ??= later[0]
      if (first) {
        cursor = await moveCursor(db, cursor, { draining: first.base })
      } else {
        pass.log.warn(
          { file: name, offset: cursor.offset },
          'el archivo rotó y no se encontró el rotado: se continúa con el nuevo',
        )
        cursor = await moveCursor(db, cursor, { inode, inodeSince: new Date(), offset: 0 })
      }
      continue
    }

    if (size < cursor.offset) {
      pass.log.warn({ file: name, offset: cursor.offset, size }, 'el log se truncó: desde 0')
      cursor = await moveCursor(db, cursor, { offset: 0 })
    }
    // Solo hasta el tamaño visto ahora: lo que Caddy escriba después, en la siguiente pasada.
    const done = await readInto(pass, cursor, { path, gzip: false }, size - cursor.offset, false)
    if (!done.eof) pass.result.more = true
    return
  }
}

interface Source {
  path: string
  gzip: boolean
}

/** El rotado sin comprimir si aún existe; si no, su `.gz`. */
function sourceOf(dir: string, rotated: RotatedName, present: Set<string>): Source | null {
  if (present.has(rotated.base)) return { path: join(dir, rotated.base), gzip: false }
  if (present.has(`${rotated.base}.gz`))
    return { path: join(dir, `${rotated.base}.gz`), gzip: true }
  return null
}

/**
 * Lee líneas completas desde el offset del cursor y guarda hits y avance por lotes. `finished`:
 * el archivo ya no crece (rotado), así que una última línea sin salto también cuenta.
 */
async function readInto(
  pass: Pass,
  start: Cursor,
  source: Source,
  available: number,
  finished: boolean,
): Promise<{ cursor: Cursor; eof: boolean }> {
  let cursor = start
  const limit = Math.min(available, pass.budget)
  if (limit <= 0) return { cursor, eof: available <= 0 }

  const stream = source.gzip
    ? createReadStream(source.path).pipe(createGunzip())
    : createReadStream(source.path, { start: cursor.offset, end: cursor.offset + limit - 1 })
  // En un .gz hay que descomprimir desde el principio y saltar lo ya leído.
  let skip = source.gzip ? cursor.offset : 0

  let pending = Buffer.alloc(0)
  let overlong = false
  let consumed = 0
  let flushedAt = 0
  let hits: NewHit[] = []
  let reachedEnd = true

  const flush = async () => {
    const offset = start.offset + consumed
    if (offset === cursor.offset && hits.length === 0) return
    const batch = hits
    hits = []
    // Verificación (R-021) antes de la transacción: puede consultar DNS.
    if (batch.length > 0) {
      const statusOf = await verificationsFor(batch)
      for (const hit of batch) hit.verified = statusOf(hit)
    }
    cursor = await db.transaction(async (tx) => {
      const moved = await moveCursor(tx, cursor, { offset })
      if (batch.length > 0) await tx.insert(botHits).values(batch)
      return moved
    })
    pass.result.hits += batch.length
    for (const hit of batch) {
      if (!pass.result.oldest || hit.ts < pass.result.oldest) pass.result.oldest = hit.ts
      if (!pass.result.newest || hit.ts > pass.result.newest) pass.result.newest = hit.ts
    }
    pass.result.bytes += consumed - flushedAt
    pass.budget -= consumed - flushedAt
    flushedAt = consumed
  }

  const takeLine = (line: Buffer) => {
    pass.result.lines += 1
    const entry = parseAccessLine(line.toString('utf8'))
    if (!entry) {
      pass.result.invalid += 1
      return
    }
    const bot = pass.classify(entry.ua)
    if (bot) hits.push({ ...entry, bot })
  }

  try {
    for await (const raw of stream as AsyncIterable<Buffer>) {
      let chunk = raw
      if (skip > 0) {
        if (chunk.length <= skip) {
          skip -= chunk.length
          continue
        }
        chunk = chunk.subarray(skip)
        skip = 0
      }
      if (source.gzip && consumed + pending.length + chunk.length > limit) {
        chunk = chunk.subarray(0, Math.max(0, limit - consumed - pending.length))
        reachedEnd = false
      }
      let from = 0
      let newline = chunk.indexOf(NEWLINE, from)
      while (newline !== -1) {
        const piece = chunk.subarray(from, newline)
        const length = pending.length + piece.length + 1
        if (!overlong) {
          const line = pending.length > 0 ? Buffer.concat([pending, piece]) : piece
          if (line.length <= MAX_LINE_BYTES) takeLine(line)
          else pass.result.invalid += 1
        } else {
          pass.result.invalid += 1
        }
        consumed += length
        pending = Buffer.alloc(0)
        overlong = false
        from = newline + 1
        newline = chunk.indexOf(NEWLINE, from)
      }
      const rest = chunk.subarray(from)
      if (overlong || pending.length + rest.length > MAX_LINE_BYTES) {
        // Línea gigante: se cuenta su tamaño, pero no se guarda en memoria.
        overlong = true
        consumed += pending.length + rest.length
        pending = Buffer.alloc(0)
      } else if (rest.length > 0) {
        pending = Buffer.concat([pending, rest])
      }
      if (hits.length >= BATCH_HITS || consumed - flushedAt >= BATCH_BYTES) await flush()
      if (!reachedEnd) break
    }
  } finally {
    stream.destroy()
  }

  // Sin comprimir, el stream ya termina en `limit`; queda sin leer si el límite fue el presupuesto.
  if (!source.gzip && limit < available) reachedEnd = false
  if (reachedEnd && finished && pending.length > 0 && !overlong) {
    takeLine(pending)
    consumed += pending.length
  } else if (overlong && reachedEnd && finished) {
    pass.result.invalid += 1
  }
  // Una línea gigante a medias se descarta entera: el cursor salta lo ya visto de ella.
  await flush()
  return { cursor, eof: reachedEnd }
}
