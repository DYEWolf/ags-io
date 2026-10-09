// Formulario de sitio (alta y edición). La validación real es siteInputSchema en el servidor.
import { useState, type SubmitEvent } from 'react'
import { Alert, Button, Field, formText } from '~/components/ui'
import type { SiteMutationResult, SiteView } from '~/functions/sites'

const LOCALES = [
  ['es-MX', 'Español (México)'],
  ['es-US', 'Español (Estados Unidos)'],
  ['es-ES', 'Español (España)'],
  ['es-CO', 'Español (Colombia)'],
  ['es-AR', 'Español (Argentina)'],
  ['es-CL', 'Español (Chile)'],
  ['es-PE', 'Español (Perú)'],
  ['es-419', 'Español (Latinoamérica)'],
  ['en-US', 'Inglés (Estados Unidos)'],
  ['en-CA', 'Inglés (Canadá)'],
  ['pt-BR', 'Portugués (Brasil)'],
] as const

const COUNTRIES = [
  'MX',
  'US',
  'ES',
  'CO',
  'AR',
  'CL',
  'PE',
  'EC',
  'GT',
  'CR',
  'PA',
  'DO',
  'PR',
  'UY',
  'PY',
  'BO',
  'VE',
  'HN',
  'SV',
  'NI',
  'CA',
  'BR',
] as const

const regionNames = new Intl.DisplayNames(['es'], { type: 'region' })

const selectClass =
  'rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none'

function FieldError({ message }: { message: string | undefined }) {
  return message ? <p className="text-xs text-red-700">{message}</p> : null
}

export function SiteForm({
  site,
  submitLabel,
  onSubmit,
  onSaved,
}: {
  site?: SiteView
  submitLabel: string
  onSubmit: (values: Record<string, string>) => Promise<SiteMutationResult>
  onSaved: (site: SiteView) => Promise<void> | void
}) {
  const [pending, setPending] = useState(false)
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({})
  const [failure, setFailure] = useState('')

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const values = Object.fromEntries(
      ['domain', 'gscProperty', 'bingSite', 'city', 'lat', 'lng', 'locale', 'country'].map(
        (name) => [name, formText(form, name)],
      ),
    )
    setPending(true)
    setFailure('')
    try {
      const result = await onSubmit(values)
      if (!result.ok) {
        setErrors(result.errors)
        return
      }
      setErrors({})
      await onSaved(result.site)
    } catch {
      setFailure('No se pudo guardar el sitio. Inténtalo de nuevo.')
    } finally {
      setPending(false)
    }
  }

  return (
    <form
      className="flex max-w-xl flex-col gap-5"
      onSubmit={(event) => void handleSubmit(event)}
      noValidate
    >
      <Alert tone="error">{failure}</Alert>
      <div className="flex flex-col gap-1">
        <Field
          label="Dominio"
          name="domain"
          defaultValue={site?.domain}
          placeholder="ejemplo.com"
          required
          autoFocus={!site}
          hint="El dominio canónico del sitio. Puedes pegar la URL completa."
        />
        <FieldError message={errors['domain']} />
      </div>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-2 text-sm font-semibold">Ubicación principal</legend>
        <div className="flex flex-col gap-1">
          <Field label="Ciudad" name="city" defaultValue={site?.city} required maxLength={120} />
          <FieldError message={errors['city']} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Field
              label="Latitud"
              name="lat"
              inputMode="decimal"
              defaultValue={site?.lat}
              placeholder="19.4326"
              required
            />
            <FieldError message={errors['lat']} />
          </div>
          <div className="flex flex-col gap-1">
            <Field
              label="Longitud"
              name="lng"
              inputMode="decimal"
              defaultValue={site?.lng}
              placeholder="-99.1332"
              required
            />
            <FieldError message={errors['lng']} />
          </div>
        </div>
        <p className="text-xs text-neutral-500">
          En Google Maps, clic derecho sobre el negocio y copia las coordenadas.
        </p>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm font-medium text-neutral-800">
          Idioma
          <select name="locale" defaultValue={site?.locale ?? 'es-MX'} className={selectClass}>
            {LOCALES.map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
          <FieldError message={errors['locale']} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-neutral-800">
          País
          <select name="country" defaultValue={site?.country ?? 'MX'} className={selectClass}>
            {COUNTRIES.map((code) => (
              <option key={code} value={code}>
                {regionNames.of(code)}
              </option>
            ))}
          </select>
          <FieldError message={errors['country']} />
        </label>
      </div>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-2 text-sm font-semibold">
          Herramientas de buscadores (opcional)
        </legend>
        <div className="flex flex-col gap-1">
          <Field
            label="Propiedad de Search Console"
            name="gscProperty"
            defaultValue={site?.gscProperty ?? ''}
            placeholder="sc-domain:ejemplo.com o https://www.ejemplo.com/"
          />
          <FieldError message={errors['gscProperty']} />
        </div>
        <div className="flex flex-col gap-1">
          <Field
            label="Sitio en Bing Webmaster Tools"
            name="bingSite"
            defaultValue={site?.bingSite ?? ''}
            placeholder="https://www.ejemplo.com/"
          />
          <FieldError message={errors['bingSite']} />
        </div>
      </fieldset>

      <div>
        <Button type="submit" pending={pending}>
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}

export function StatusBadge({ status }: { status: SiteView['status'] }) {
  return status === 'active' ? (
    <span className="rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-800">Activo</span>
  ) : (
    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">Pausado</span>
  )
}
