// Piezas compartidas por las listas del panel de staff.
import { useNavigate } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { Button, formText } from '~/components/ui'

export function SearchBox({ value, placeholder }: { value: string; placeholder: string }) {
  const navigate = useNavigate()
  return (
    <form
      className="flex gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        const q = formText(new FormData(event.currentTarget), 'q').trim()
        void navigate({ to: '.', search: { page: 1, q } })
      }}
    >
      <input
        name="q"
        type="search"
        defaultValue={value}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full max-w-xs rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
      />
      <Button type="submit" variant="secondary">
        Buscar
      </Button>
    </form>
  )
}

export function Pagination({
  page,
  pageSize,
  total,
}: {
  page: number
  pageSize: number
  total: number
}) {
  const navigate = useNavigate()
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const go = (target: number) =>
    void navigate({
      to: '.',
      search: (prev: Record<string, unknown>) => ({ ...prev, page: target }),
    })
  return (
    <div className="flex items-center justify-between text-sm text-neutral-600">
      <span>
        {total} en total · página {page} de {pages}
      </span>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          disabled={page <= 1}
          onClick={() => {
            go(page - 1)
          }}
        >
          Anterior
        </Button>
        <Button
          variant="secondary"
          disabled={page >= pages}
          onClick={() => {
            go(page + 1)
          }}
        >
          Siguiente
        </Button>
      </div>
    </div>
  )
}

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-neutral-200 bg-neutral-50 text-xs text-neutral-500 uppercase">
          <tr>
            {head.map((label) => (
              <th key={label} scope="col" className="px-4 py-2 font-medium">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-200">{children}</tbody>
      </table>
    </div>
  )
}

export function Badge({
  tone,
  children,
}: {
  tone: 'green' | 'red' | 'neutral' | 'amber'
  children: ReactNode
}) {
  const tones = {
    green: 'bg-green-100 text-green-800',
    red: 'bg-red-100 text-red-800',
    neutral: 'bg-neutral-100 text-neutral-700',
    amber: 'bg-amber-100 text-amber-900',
  }
  return <span className={`rounded px-1.5 py-0.5 text-xs ${tones[tone]}`}>{children}</span>
}
