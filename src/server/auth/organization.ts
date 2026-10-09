// Multi-tenencia (R-005): cada cliente tiene su organización y es su owner.
import { randomBytes, randomUUID } from 'node:crypto'
import { and, asc, eq, sql } from 'drizzle-orm'
import { db } from '~/db/client'
import { member, organization } from '~/db/schema'
import { logger } from '~/lib/logger'

const log = logger.child({ component: 'organization' })

function slugify(value: string): string {
  const base = value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  // Sufijo aleatorio: el slug es único y no debe revelar si otro nombre igual ya existe.
  return `${base || 'org'}-${randomBytes(4).toString('hex')}`
}

/** Organización más antigua de la que el usuario es miembro. */
export async function firstMembership(userId: string) {
  const [row] = await db
    .select({ organizationId: member.organizationId, role: member.role })
    .from(member)
    .where(eq(member.userId, userId))
    .orderBy(asc(member.createdAt))
    .limit(1)
  return row ?? null
}

/**
 * Crea la organización del usuario con él como owner si aún no pertenece a ninguna.
 * Idempotente y segura ante llamadas concurrentes (lock por usuario).
 */
export async function ensureOrganization(user: { id: string; name: string }): Promise<string> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`org:${user.id}`}))`)

    const [existing] = await tx
      .select({ organizationId: member.organizationId })
      .from(member)
      .where(eq(member.userId, user.id))
      .orderBy(asc(member.createdAt))
      .limit(1)
    if (existing) return existing.organizationId

    const organizationId = randomUUID()
    await tx.insert(organization).values({
      id: organizationId,
      name: user.name,
      slug: slugify(user.name),
    })
    await tx.insert(member).values({
      id: randomUUID(),
      organizationId,
      userId: user.id,
      role: 'owner',
    })
    log.info({ userId: user.id, organizationId }, 'organización creada')
    return organizationId
  })
}

/**
 * Al eliminar una cuenta (R-004): borra las organizaciones donde el usuario es el único owner,
 * con todos sus datos (las FKs de negocio cuelgan de `organization` con ON DELETE CASCADE).
 */
export async function deleteSoleOwnedOrganizations(userId: string): Promise<void> {
  const owned = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.role, 'owner')))

  for (const { organizationId } of owned) {
    const [others] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(member)
      .where(
        and(
          eq(member.organizationId, organizationId),
          eq(member.role, 'owner'),
          sql`${member.userId} <> ${userId}`,
        ),
      )
    if ((others?.count ?? 0) === 0) {
      await db.delete(organization).where(eq(organization.id, organizationId))
      log.info({ userId, organizationId }, 'organización eliminada con la cuenta')
    }
  }
}
