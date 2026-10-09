import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { Pagination, SearchBox } from '~/components/staff'
import { Alert, Badge, Button, dateTimeFormat, Table } from '~/components/ui'
import { staffListSchema, staffListUsers, type StaffUserRow } from '~/functions/staff'
import { isStaff } from '~/lib/access'
import { authClient, authErrorMessage } from '~/lib/auth-client'

export const Route = createFileRoute('/_app/staff/')({
  validateSearch: staffListSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => staffListUsers({ data: deps }),
  head: () => ({ meta: [{ title: 'Usuarios · Staff · ags-io' }] }),
  component: StaffUsersPage,
})

function StaffUsersPage() {
  const search = Route.useSearch()
  const { total, pageSize, rows } = Route.useLoaderData()
  const [error, setError] = useState('')

  return (
    <div className="flex flex-col gap-4">
      <SearchBox value={search.q} placeholder="Buscar por correo" />
      <Alert tone="error">{error}</Alert>
      <Table head={['Usuario', 'Estado', 'Rol', '2FA', 'Alta', '']}>
        {rows.map((row) => (
          <UserRow key={row.id} row={row} onError={setError} />
        ))}
      </Table>
      {rows.length === 0 ? <p className="text-sm text-neutral-500">Sin resultados.</p> : null}
      <Pagination page={search.page} pageSize={pageSize} total={total} />
    </div>
  )
}

function UserRow({ row, onError }: { row: StaffUserRow; onError: (message: string) => void }) {
  const router = useRouter()
  const { viewer } = Route.useRouteContext()
  const [pending, setPending] = useState(false)
  const [confirmBan, setConfirmBan] = useState(false)
  const [reason, setReason] = useState('')
  const self = row.id === viewer.user.id
  const staffRow = isStaff(row.role)

  async function act(action: () => Promise<{ error: Parameters<typeof authErrorMessage>[0] }>) {
    setPending(true)
    onError('')
    const { error } = await action()
    setPending(false)
    setConfirmBan(false)
    if (error) onError(authErrorMessage(error))
    await router.invalidate()
  }

  async function impersonate() {
    setPending(true)
    const { error } = await authClient.admin.impersonateUser({ userId: row.id })
    if (error) {
      setPending(false)
      onError(authErrorMessage(error))
      return
    }
    window.location.assign('/panel')
  }

  return (
    <tr className="align-top">
      <td className="px-4 py-3">
        <p className="font-medium">{row.name}</p>
        <p className="text-neutral-600">{row.email}</p>
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-col items-start gap-1">
          {row.banned ? <Badge tone="red">Suspendido</Badge> : <Badge tone="green">Activo</Badge>}
          {row.emailVerified ? null : <Badge tone="amber">Sin verificar</Badge>}
          {row.banned && row.banReason ? (
            <span className="text-xs text-neutral-500">{row.banReason}</span>
          ) : null}
        </div>
      </td>
      <td className="px-4 py-3">{staffRow ? <Badge tone="neutral">staff</Badge> : 'cliente'}</td>
      <td className="px-4 py-3">{row.twoFactorEnabled ? 'Sí' : 'No'}</td>
      <td className="px-4 py-3 whitespace-nowrap text-neutral-600">
        {dateTimeFormat.format(new Date(row.createdAt))}
      </td>
      <td className="px-4 py-3">
        {self ? null : confirmBan ? (
          <form
            className="flex min-w-56 flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              void act(() =>
                authClient.admin.banUser({
                  userId: row.id,
                  ...(reason.trim() ? { banReason: reason.trim() } : {}),
                }),
              )
            }}
          >
            <input
              value={reason}
              onChange={(event) => {
                setReason(event.target.value)
              }}
              placeholder="Motivo (opcional)"
              aria-label="Motivo de la suspensión"
              maxLength={200}
              className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
            />
            <div className="flex gap-2">
              <Button type="submit" variant="danger" pending={pending}>
                Suspender
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setConfirmBan(false)
                }}
              >
                Cancelar
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap justify-end gap-2">
            {row.banned ? (
              <Button
                variant="secondary"
                pending={pending}
                onClick={() => void act(() => authClient.admin.unbanUser({ userId: row.id }))}
              >
                Reactivar
              </Button>
            ) : (
              <Button
                variant="secondary"
                disabled={staffRow}
                onClick={() => {
                  setConfirmBan(true)
                }}
              >
                Suspender
              </Button>
            )}
            <Button
              variant="secondary"
              pending={pending}
              disabled={staffRow || row.banned}
              onClick={() => void impersonate()}
            >
              Impersonar
            </Button>
          </div>
        )}
      </td>
    </tr>
  )
}
