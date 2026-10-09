// Roles de plataforma (R-006): `user` (cliente) y `staff` (opera la plataforma).
// Se comparte entre servidor y cliente: no importa nada de servidor.
import { createAccessControl } from 'better-auth/plugins/access'
import { adminAc, defaultStatements, userAc } from 'better-auth/plugins/admin/access'

export const ac = createAccessControl(defaultStatements)

export const roles = {
  user: ac.newRole(userAc.statements),
  staff: ac.newRole(adminAc.statements),
}

export type PlatformRole = keyof typeof roles

export const isStaff = (role: string | null | undefined) =>
  (role ?? '').split(',').includes('staff')
