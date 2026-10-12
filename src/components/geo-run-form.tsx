// Formulario de corrida manual (R-051). La validación real está en el servidor
// (domain/geo/runs.ts); aquí solo se recogen los valores y se muestran sus errores.
import { useState, type SubmitEvent } from 'react'
import { textareaClass } from '~/components/geo-forms'
import { FieldError, selectClass } from '~/components/site-form'
import { Alert, Button, Field, formText } from '~/components/ui'
import { engineLabel, ENGINES, MAX_ANSWER_CHARS, modeLabel, RUN_MODES } from '~/domain/geo/runs'
import type { PromptView } from '~/functions/geo'
import type { RunDetail, RunMutationResult } from '~/functions/geo-runs'

const FIELDS = ['promptId', 'engine', 'mode', 'model', 'runAt', 'answer', 'citations', 'notes']

export function RunForm({
  run,
  prompts,
  defaults,
  submitLabel,
  onSubmit,
  onSaved,
  onCancel,
}: {
  run?: RunDetail
  /** Prompts del sitio; se ofrecen los activos y, al editar, el de la corrida. */
  prompts: PromptView[]
  defaults: { promptId?: string; runAt: string }
  submitLabel: string
  onSubmit: (values: Record<string, string>) => Promise<RunMutationResult>
  onSaved: (id: string) => Promise<void>
  onCancel?: () => void
}) {
  const [pending, setPending] = useState(false)
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({})
  const [failure, setFailure] = useState('')
  const options = prompts.filter((prompt) => prompt.active || prompt.id === run?.promptId)

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const values = Object.fromEntries(FIELDS.map((name) => [name, formText(form, name)]))
    setPending(true)
    setFailure('')
    try {
      const result = await onSubmit(values)
      if (!result.ok) {
        setErrors(result.errors)
        return
      }
      setErrors({})
      await onSaved(result.id)
    } catch {
      setFailure('No se pudo guardar la corrida. Inténtalo de nuevo.')
    } finally {
      setPending(false)
    }
  }

  return (
    <form
      className="flex max-w-3xl flex-col gap-5"
      onSubmit={(event) => void handleSubmit(event)}
      noValidate
    >
      <Alert tone="error">{failure || errors['form']}</Alert>

      <label className="flex flex-col gap-1 text-sm font-medium text-neutral-800">
        Prompt
        <select
          name="promptId"
          defaultValue={run?.promptId ?? defaults.promptId ?? ''}
          className={selectClass}
        >
          <option value="" disabled>
            Elige el prompt…
          </option>
          {options.map((prompt) => (
            <option key={prompt.id} value={prompt.id}>
              {prompt.text.length > 120 ? `${prompt.text.slice(0, 117)}…` : prompt.text}
              {prompt.active ? '' : ' (archivado)'}
            </option>
          ))}
        </select>
        <FieldError message={errors['promptId']} />
      </label>

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm font-medium text-neutral-800">
          Motor
          <select name="engine" defaultValue={run?.engine ?? ''} className={selectClass}>
            <option value="" disabled>
              Elige el motor…
            </option>
            {ENGINES.map((engine) => (
              <option key={engine} value={engine}>
                {engineLabel[engine]}
              </option>
            ))}
          </select>
          <FieldError message={errors['engine']} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-neutral-800">
          Modo (opcional)
          <select name="mode" defaultValue={run?.mode ?? ''} className={selectClass}>
            <option value="">Sin indicar</option>
            {RUN_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {modeLabel[mode]}
              </option>
            ))}
          </select>
          <FieldError message={errors['mode']} />
        </label>
        <div className="flex flex-col gap-1">
          <Field
            label="Modelo (opcional)"
            name="model"
            maxLength={80}
            defaultValue={run?.model ?? ''}
            placeholder="GPT-5, Sonar…"
          />
          <FieldError message={errors['model']} />
        </div>
      </div>

      <div className="flex max-w-xs flex-col gap-1">
        <Field
          label="Fecha y hora"
          name="runAt"
          type="datetime-local"
          required
          defaultValue={run?.runAtInput ?? defaults.runAt}
          hint="Hora de Ciudad de México."
        />
        <FieldError message={errors['runAt']} />
      </div>

      <div className="flex flex-col gap-1">
        <label className="flex flex-col gap-1 text-sm font-medium text-neutral-800">
          Respuesta
          <textarea
            name="answer"
            rows={12}
            required
            maxLength={MAX_ANSWER_CHARS}
            defaultValue={run?.answer}
            placeholder="Pega aquí la respuesta completa del motor."
            className={textareaClass}
          />
        </label>
        <p className="text-xs text-neutral-500">
          Cópiala completa, tal cual. Es la evidencia con la que calculamos las menciones.
        </p>
        <FieldError message={errors['answer']} />
      </div>

      <div className="flex flex-col gap-1">
        <label className="flex flex-col gap-1 text-sm font-medium text-neutral-800">
          URLs citadas (opcional)
          <textarea
            name="citations"
            rows={5}
            defaultValue={run?.citations
              .filter((citation) => citation.origin !== 'answer')
              .map((citation) => citation.url)
              .join('\n')}
            placeholder={'https://ejemplo.com/articulo\nhttps://otro.com/'}
            className={`${textareaClass} font-mono`}
          />
        </label>
        <p className="text-xs text-neutral-500">
          Una por línea: las fuentes que muestra el motor. Las URLs que aparezcan dentro de la
          respuesta se añaden solas.
        </p>
        <FieldError message={errors['citations']} />
      </div>

      <label className="flex flex-col gap-1 text-sm font-medium text-neutral-800">
        Notas (opcional)
        <textarea
          name="notes"
          rows={2}
          maxLength={1000}
          defaultValue={run?.notes ?? ''}
          placeholder="Cuenta usada, si había sesión iniciada, ubicación del navegador…"
          className={textareaClass}
        />
        <FieldError message={errors['notes']} />
      </label>

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
