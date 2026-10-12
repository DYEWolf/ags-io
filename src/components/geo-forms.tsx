// Formularios de GEO (R-050): prompt y competidor. La validación real está en el servidor
// (domain/geo/config.ts); aquí solo se recogen los valores y se muestran sus errores.
import { useState, type SubmitEvent } from 'react'
import { FieldError, LOCALES, selectClass } from '~/components/site-form'
import { Alert, Button, Field, formText } from '~/components/ui'
import {
  intentHint,
  intentLabel,
  MAX_PROMPT_CHARS,
  PROMPT_INTENTS,
  type PromptIntent,
} from '~/domain/geo/config'
import type { CompetitorView, GeoMutationResult, PromptView } from '~/functions/geo'

export const textareaClass =
  'rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none'

type Errors = Partial<Record<string, string>>

/** Envía el formulario y reparte el resultado: errores por campo, fallo genérico o guardado. */
function useMutationForm(failureText: string) {
  const [pending, setPending] = useState(false)
  const [errors, setErrors] = useState<Errors>({})
  const [failure, setFailure] = useState('')

  async function submit(run: () => Promise<GeoMutationResult>, onSaved: () => Promise<void>) {
    setPending(true)
    setFailure('')
    try {
      const result = await run()
      if (!result.ok) {
        setErrors(result.errors)
        return
      }
      setErrors({})
      await onSaved()
    } catch {
      setFailure(failureText)
    } finally {
      setPending(false)
    }
  }

  return { pending, errors, failure, submit }
}

export function PromptForm({
  prompt,
  defaults,
  submitLabel,
  onSubmit,
  onSaved,
  onCancel,
}: {
  prompt?: PromptView
  /** Idioma y ubicación del sitio, usados para un prompt nuevo. */
  defaults: { locale: string; location: string }
  submitLabel: string
  onSubmit: (values: Record<string, unknown>) => Promise<GeoMutationResult>
  onSaved: () => Promise<void>
  onCancel?: () => void
}) {
  const { pending, errors, failure, submit } = useMutationForm(
    'No se pudo guardar el prompt. Inténtalo de nuevo.',
  )
  const [intent, setIntent] = useState<PromptIntent>(prompt?.intent ?? 'category')
  const locale = prompt?.locale ?? defaults.locale
  const locales = LOCALES.some(([code]) => code === locale)
    ? LOCALES
    : [[locale, locale] as const, ...LOCALES]

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const values = {
      text: formText(data, 'text'),
      intent: formText(data, 'intent'),
      branded: data.get('branded') === 'on',
      locale: formText(data, 'locale'),
      location: formText(data, 'location'),
    }
    void submit(
      () => onSubmit(values),
      async () => {
        if (!prompt) form.reset()
        await onSaved()
      },
    )
  }

  return (
    <form className="flex max-w-2xl flex-col gap-4" onSubmit={handleSubmit} noValidate>
      <Alert tone="error">{failure || errors['form']}</Alert>
      <div className="flex flex-col gap-1">
        <label className="flex flex-col gap-1 text-sm font-medium text-neutral-800">
          Prompt
          <textarea
            name="text"
            rows={2}
            required
            maxLength={MAX_PROMPT_CHARS}
            defaultValue={prompt?.text}
            placeholder="¿Cuál es la mejor panadería de masa madre en Coyoacán?"
            className={textareaClass}
          />
        </label>
        <p className="text-xs text-neutral-500">
          Escríbelo como lo preguntaría un cliente en ChatGPT o Perplexity.
        </p>
        <FieldError message={errors['text']} />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium text-neutral-800">Intención</legend>
        <div className="flex flex-wrap gap-4">
          {PROMPT_INTENTS.map((value) => (
            <label key={value} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="intent"
                value={value}
                checked={intent === value}
                onChange={() => {
                  setIntent(value)
                }}
              />
              {intentLabel[value]}
            </label>
          ))}
        </div>
        <p className="text-xs text-neutral-500">{intentHint[intent]}</p>
        <FieldError message={errors['intent']} />
      </fieldset>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="branded"
          defaultChecked={prompt?.branded ?? false}
          className="mt-0.5"
        />
        <span>
          <span className="font-medium text-neutral-800">Incluye la marca</span>
          <span className="block text-xs text-neutral-500">
            Márcalo si el prompt nombra tu negocio. Las métricas de visibilidad se calculan aparte
            para estos prompts: en ellos, que la IA te mencione es lo esperado.
          </span>
        </span>
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm font-medium text-neutral-800">
          Idioma
          <select name="locale" defaultValue={locale} className={selectClass}>
            {locales.map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
          <FieldError message={errors['locale']} />
        </label>
        <div className="flex flex-col gap-1">
          <Field
            label="Ubicación (opcional)"
            name="location"
            maxLength={120}
            defaultValue={prompt ? (prompt.location ?? '') : defaults.location}
            hint="Desde dónde se pregunta. Ayuda a repetir la corrida en las mismas condiciones."
          />
          <FieldError message={errors['location']} />
        </div>
      </div>

      <div className="flex gap-2">
        <Button type="submit" pending={pending}>
          {submitLabel}
        </Button>
        {onCancel ? (
          <Button variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
        ) : null}
      </div>
    </form>
  )
}

export function CompetitorForm({
  competitor,
  submitLabel,
  onSubmit,
  onSaved,
  onCancel,
}: {
  competitor?: CompetitorView
  submitLabel: string
  onSubmit: (values: Record<string, unknown>) => Promise<GeoMutationResult>
  onSaved: () => Promise<void>
  onCancel?: () => void
}) {
  const { pending, errors, failure, submit } = useMutationForm(
    'No se pudo guardar el competidor. Inténtalo de nuevo.',
  )

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const values = {
      name: formText(data, 'name'),
      aliases: formText(data, 'aliases'),
      domains: formText(data, 'domains'),
    }
    void submit(
      () => onSubmit(values),
      async () => {
        if (!competitor) form.reset()
        await onSaved()
      },
    )
  }

  return (
    <form className="flex max-w-2xl flex-col gap-4" onSubmit={handleSubmit} noValidate>
      <Alert tone="error">{failure || errors['form']}</Alert>
      <div className="flex flex-col gap-1">
        <Field
          label="Nombre"
          name="name"
          required
          maxLength={100}
          defaultValue={competitor?.name}
          placeholder="Panadería Rosetta"
        />
        <FieldError message={errors['name']} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className="flex flex-col gap-1 text-sm font-medium text-neutral-800">
            Otros nombres (opcional)
            <textarea
              name="aliases"
              rows={3}
              defaultValue={competitor?.aliases.join('\n')}
              placeholder={'Rosetta\nRosetta Panadería'}
              className={textareaClass}
            />
          </label>
          <p className="text-xs text-neutral-500">
            Uno por línea: cómo podría llamarlo una IA. El nombre ya cuenta.
          </p>
          <FieldError message={errors['aliases']} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="flex flex-col gap-1 text-sm font-medium text-neutral-800">
            Dominios (opcional)
            <textarea
              name="domains"
              rows={3}
              defaultValue={competitor?.domains.join('\n')}
              placeholder="rosetta.com.mx"
              className={`${textareaClass} font-mono`}
            />
          </label>
          <p className="text-xs text-neutral-500">
            Uno por línea. Sirven para detectar cuándo la IA cita su sitio.
          </p>
          <FieldError message={errors['domains']} />
        </div>
      </div>
      <div className="flex gap-2">
        <Button type="submit" pending={pending}>
          {submitLabel}
        </Button>
        {onCancel ? (
          <Button variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
        ) : null}
      </div>
    </form>
  )
}

/**
 * Botón de eliminar con confirmación en línea (sin diálogos del navegador): el primer clic pide
 * confirmar y el segundo ejecuta.
 */
export function ConfirmDelete({
  label,
  confirmLabel,
  onConfirm,
}: {
  label: string
  confirmLabel: string
  onConfirm: () => Promise<void>
}) {
  const [asking, setAsking] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  async function run() {
    setPending(true)
    setError('')
    try {
      await onConfirm()
    } catch {
      setError('No se pudo eliminar.')
      setPending(false)
    }
  }

  if (!asking) {
    return (
      <Button
        variant="ghost"
        className="text-red-700"
        onClick={() => {
          setAsking(true)
        }}
      >
        {label}
      </Button>
    )
  }
  return (
    <span className="flex items-center gap-2">
      <span className="text-sm text-red-800">{error || confirmLabel}</span>
      <Button variant="danger" pending={pending} onClick={() => void run()}>
        Sí, eliminar
      </Button>
      <Button
        variant="ghost"
        onClick={() => {
          setAsking(false)
          setError('')
        }}
      >
        No
      </Button>
    </span>
  )
}
