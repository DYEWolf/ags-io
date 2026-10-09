import { createFileRoute } from '@tanstack/react-router'
import { Pagination, SearchBox } from '~/components/staff'
import { dateTimeFormat, Table } from '~/components/ui'
import { staffListOrganizations, staffListSchema } from '~/functions/staff'

export const Route = createFileRoute('/_app/staff/organizaciones')({
  validateSearch: staffListSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => staffListOrganizations({ data: deps }),
  head: () => ({ meta: [{ title: 'Organizaciones · Staff · ags-io' }] }),
  component: StaffOrganizationsPage,
})

function StaffOrganizationsPage() {
  const search = Route.useSearch()
  const { total, pageSize, rows } = Route.useLoaderData()

  return (
    <div className="flex flex-col gap-4">
      <SearchBox value={search.q} placeholder="Buscar por nombre o slug" />
      <Table head={['Organización', 'Owners', 'Miembros', 'Alta']}>
        {rows.map((row) => (
          <tr key={row.id}>
            <td className="px-4 py-3">
              <p className="font-medium">{row.name}</p>
              <p className="font-mono text-xs text-neutral-500">{row.slug}</p>
            </td>
            <td className="px-4 py-3 text-neutral-700">{row.owners.join(', ') || '—'}</td>
            <td className="px-4 py-3">{row.members}</td>
            <td className="px-4 py-3 whitespace-nowrap text-neutral-600">
              {dateTimeFormat.format(new Date(row.createdAt))}
            </td>
          </tr>
        ))}
      </Table>
      {rows.length === 0 ? <p className="text-sm text-neutral-500">Sin resultados.</p> : null}
      <Pagination page={search.page} pageSize={pageSize} total={total} />
    </div>
  )
}
