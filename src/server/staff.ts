// Consultas del panel de staff (R-006). Solo se llaman tras `staffMiddleware`.
import { asc, count, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm'
import { db } from '~/db/client'
import { member, organization, user } from '~/db/schema'

export const STAFF_PAGE_SIZE = 20

export interface StaffOrganizationRow {
  id: string
  name: string
  slug: string
  createdAt: string
  owners: string[]
  members: number
}

export async function listOrganizations(options: { page: number; search: string }) {
  const where = options.search
    ? or(
        ilike(organization.name, `%${options.search}%`),
        ilike(organization.slug, `%${options.search}%`),
      )
    : undefined

  const rows = await db
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      createdAt: organization.createdAt,
      members: count(member.id),
      owners: sql<
        string[] | null
      >`array_agg(${user.email} order by ${user.email}) filter (where ${member.role} = 'owner')`,
    })
    .from(organization)
    .leftJoin(member, eq(member.organizationId, organization.id))
    .leftJoin(user, eq(user.id, member.userId))
    .where(where)
    .groupBy(organization.id)
    .orderBy(desc(organization.createdAt), asc(organization.id))
    .limit(STAFF_PAGE_SIZE)
    .offset((options.page - 1) * STAFF_PAGE_SIZE)

  const [total] = await db.select({ value: count() }).from(organization).where(where)

  return {
    total: total?.value ?? 0,
    rows: rows.map((row): StaffOrganizationRow => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      createdAt: row.createdAt.toISOString(),
      owners: row.owners ?? [],
      members: row.members,
    })),
  }
}

export async function organizationsByIds(ids: string[]) {
  if (ids.length === 0) return new Map<string, { name: string; slug: string }>()
  const rows = await db
    .select({ id: organization.id, name: organization.name, slug: organization.slug })
    .from(organization)
    .where(inArray(organization.id, ids))
  return new Map(rows.map((row) => [row.id, { name: row.name, slug: row.slug }]))
}

export async function organizationIdBySlugOrId(value: string): Promise<string | null> {
  const [row] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(or(eq(organization.slug, value), eq(organization.id, value)))
    .limit(1)
  return row?.id ?? null
}
