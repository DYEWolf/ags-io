// Resuelve la sesión de la petición y su organización activa (R-001, R-005).
import { and, eq } from 'drizzle-orm'
import { db } from '~/db/client'
import { member, organization } from '~/db/schema'
import type { Viewer } from '~/lib/viewer'
import { auth } from '~/server/auth'
import { ensureOrganization } from '~/server/auth/organization'

async function membership(userId: string, organizationId: string) {
  const [row] = await db
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      role: member.role,
    })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(and(eq(member.userId, userId), eq(member.organizationId, organizationId)))
    .limit(1)
  return row ?? null
}

export async function loadViewer(headers: Headers): Promise<Viewer | null> {
  const result = await auth.api.getSession({ headers })
  if (!result) return null
  const { user, session } = result

  // La organización activa de la sesión solo vale si el usuario sigue siendo miembro. Si no
  // tiene ninguna (p. ej. staff creado por CLI), se crea; la sesión implica email verificado.
  const active = session.activeOrganizationId
    ? await membership(user.id, session.activeOrganizationId)
    : null
  const current = active ?? (await membership(user.id, await ensureOrganization(user)))
  if (!current) throw new Error(`usuario ${user.id} sin organización tras crearla`)

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role ?? 'user',
      twoFactorEnabled: user.twoFactorEnabled === true,
    },
    session: {
      id: session.id,
      impersonatedBy: session.impersonatedBy ?? null,
    },
    organization: current,
  }
}
