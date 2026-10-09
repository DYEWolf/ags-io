// Componentes base del dashboard. Tailwind, sin dependencias de UI.
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'
import { useId } from 'react'

const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(' ')

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-neutral-900 text-white hover:bg-neutral-700 disabled:bg-neutral-400',
  secondary:
    'border border-neutral-300 bg-white text-neutral-900 hover:bg-neutral-100 disabled:text-neutral-400',
  danger: 'bg-red-600 text-white hover:bg-red-500 disabled:bg-red-300',
  ghost: 'text-neutral-700 hover:bg-neutral-100 disabled:text-neutral-400',
}

export function Button({
  variant = 'primary',
  pending = false,
  className,
  children,
  disabled,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; pending?: boolean }) {
  return (
    <button
      type={type}
      disabled={disabled === true || pending}
      aria-busy={pending}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 disabled:cursor-not-allowed',
        buttonVariants[variant],
        className,
      )}
      {...props}
    >
      {pending ? 'Procesando…' : children}
    </button>
  )
}

export function Field({
  label,
  hint,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  const id = useId()
  const hintId = `${id}-hint`
  return (
    <div className={cx('flex flex-col gap-1', className)}>
      <label htmlFor={id} className="text-sm font-medium text-neutral-800">
        {label}
      </label>
      <input
        id={id}
        aria-describedby={hint ? hintId : undefined}
        className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm shadow-xs focus:border-neutral-900 focus:outline-none disabled:bg-neutral-100"
        {...props}
      />
      {hint ? (
        <p id={hintId} className="text-xs text-neutral-500">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

type AlertTone = 'error' | 'success' | 'info' | 'warning'

const alertTones: Record<AlertTone, string> = {
  error: 'border-red-200 bg-red-50 text-red-800',
  success: 'border-green-200 bg-green-50 text-green-800',
  info: 'border-neutral-200 bg-neutral-100 text-neutral-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
}

export function Alert({ tone = 'info', children }: { tone?: AlertTone; children: ReactNode }) {
  if (!children) return null
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cx('rounded-md border px-3 py-2 text-sm', alertTones[tone])}
    >
      {children}
    </div>
  )
}

export function Card({
  title,
  description,
  children,
  tone = 'default',
}: {
  title: string
  description?: ReactNode
  children: ReactNode
  tone?: 'default' | 'danger'
}) {
  return (
    <section
      className={cx(
        'rounded-lg border bg-white p-6 shadow-xs',
        tone === 'danger' ? 'border-red-200' : 'border-neutral-200',
      )}
    >
      <h2 className="text-base font-semibold">{title}</h2>
      {description ? <p className="mt-1 text-sm text-neutral-600">{description}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  )
}

export function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: string
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <div className="w-full max-w-sm">
      <p className="mb-6 text-center text-lg font-semibold">ags-io</p>
      <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-xs">
        <h1 className="text-xl font-semibold">{title}</h1>
        {description ? <p className="mt-1 text-sm text-neutral-600">{description}</p> : null}
        <div className="mt-6">{children}</div>
      </div>
      {footer ? <div className="mt-4 text-center text-sm text-neutral-600">{footer}</div> : null}
    </div>
  )
}

/** Lee un campo de texto de un FormData (los inputs de texto nunca son File). */
export function formText(form: FormData, name: string): string {
  const value = form.get(name)
  return typeof value === 'string' ? value : ''
}

export const dateTimeFormat = new Intl.DateTimeFormat('es-MX', {
  dateStyle: 'medium',
  timeStyle: 'short',
  // R-075: todo se guarda en UTC y se muestra en hora de Ciudad de México.
  timeZone: 'America/Mexico_City',
})

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
