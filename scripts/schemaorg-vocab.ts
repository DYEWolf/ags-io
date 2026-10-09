// Genera el vocabulario compacto de schema.org que usa el auditor de JSON-LD (R-031).
//
//   pnpm schemaorg:update
//
// Descarga la versión vigente publicada por schema.org y escribe
// src/domain/audit/schemaorg.json: tipos con sus supertipos, propiedades con los tipos a los
// que aplican (domainIncludes) y términos reemplazados (supersededBy). Se versiona en el repo:
// el auditor no depende de la red para validar.
import { writeFileSync } from 'node:fs'
import { z } from 'zod'

const SOURCE = 'https://schema.org/version/latest/schemaorg-current-https.jsonld'
const OUTPUT = 'src/domain/audit/schemaorg.json'

const ref = z.object({ '@id': z.string() })
const refs = z
  .union([ref, z.array(ref)])
  .optional()
  .transform((value) => (value === undefined ? [] : Array.isArray(value) ? value : [value]))

const node = z.object({
  '@id': z.string(),
  '@type': z.union([z.string(), z.array(z.string())]),
  'rdfs:subClassOf': refs,
  'schema:domainIncludes': refs,
  'schema:supersededBy': refs,
})

const vocabulary = z.object({ '@graph': z.array(z.unknown()) })

const local = (id: string) => id.replace(/^schema:/, '')

const response = await fetch(SOURCE)
if (!response.ok) throw new Error(`schema.org respondió ${String(response.status)}`)
const graph = vocabulary.parse(await response.json())['@graph']

const types: Record<string, string[]> = {}
const properties: Record<string, string[]> = {}
const superseded: Record<string, string> = {}

for (const raw of graph) {
  const parsed = node.safeParse(raw)
  if (!parsed.success || !parsed.data['@id'].startsWith('schema:')) continue
  const item = parsed.data
  const name = local(item['@id'])
  const kinds = Array.isArray(item['@type']) ? item['@type'] : [item['@type']]
  if (kinds.includes('rdfs:Class')) {
    types[name] = item['rdfs:subClassOf'].map((parent) => local(parent['@id'])).sort()
  } else if (kinds.includes('rdf:Property')) {
    properties[name] = item['schema:domainIncludes'].map((domain) => local(domain['@id'])).sort()
  } else {
    continue
  }
  const replacement = item['schema:supersededBy'][0]
  if (replacement) superseded[name] = local(replacement['@id'])
}

const sorted = <T>(record: Record<string, T>) =>
  Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)))

writeFileSync(
  OUTPUT,
  `${JSON.stringify({
    source: SOURCE,
    fetchedAt: new Date().toISOString().slice(0, 10),
    types: sorted(types),
    properties: sorted(properties),
    superseded: sorted(superseded),
  })}\n`,
)
process.stdout.write(
  `${OUTPUT}: ${String(Object.keys(types).length)} tipos, ${String(Object.keys(properties).length)} propiedades\n`,
)
