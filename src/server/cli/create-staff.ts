// R-006: el primer staff se crea por CLI, nunca desde la UI.
//
//   pnpm staff:create --email tu@correo --name "Tu nombre"            (desarrollo)
//   docker compose exec -it web node dist/node/create-staff.mjs --email … --name …
//
// Pide la contraseña sin mostrarla (o la lee de STAFF_PASSWORD si no hay terminal).
// Con --promote convierte en staff a un usuario que ya existe.
import { stdin, stdout } from 'node:process'
import { createInterface } from 'node:readline/promises'
import { parseArgs } from 'node:util'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db, pool } from '~/db/client'
import { user } from '~/db/schema'
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '~/lib/password-policy'
import { auth } from '~/server/auth'
import { ensureOrganization } from '~/server/auth/organization'

async function readHidden(prompt: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout, terminal: true })
  // Silencia el eco de lo que se escribe sin tocar el texto del prompt.
  const output = rl as unknown as { _writeToOutput: (text: string) => void }
  let muted = false
  const write = output._writeToOutput.bind(rl)
  output._writeToOutput = (text) => {
    if (!muted) write(text)
  }
  const answer = rl.question(prompt)
  muted = true
  const value = await answer
  rl.close()
  stdout.write('\n')
  return value
}

async function readPassword(): Promise<string> {
  const fromEnv = process.env['STAFF_PASSWORD']
  if (fromEnv) return fromEnv
  if (!stdin.isTTY) throw new Error('Sin terminal: pasa la contraseña en STAFF_PASSWORD')
  const first = await readHidden('Contraseña: ')
  const second = await readHidden('Repite la contraseña: ')
  if (first !== second) throw new Error('Las contraseñas no coinciden')
  return first
}

const argsSchema = z.object({
  email: z.email('correo inválido'),
  name: z.string().trim().min(1, 'falta --name').max(100),
  promote: z.boolean(),
})

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      name: { type: 'string', default: 'Staff' },
      promote: { type: 'boolean', default: false },
    },
  })
  const args = argsSchema.parse(values)
  const email = args.email.toLowerCase()

  const [existing] = await db.select().from(user).where(eq(user.email, email)).limit(1)
  if (existing) {
    if (!args.promote) {
      throw new Error(`${email} ya existe. Usa --promote para convertirlo en staff.`)
    }
    await db.update(user).set({ role: 'staff' }).where(eq(user.id, existing.id))
    stdout.write(`${email} ahora es staff.\n`)
    return
  }

  const password = await readPassword()
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    throw new Error(
      `La contraseña debe tener entre ${String(MIN_PASSWORD_LENGTH)} y ${String(MAX_PASSWORD_LENGTH)} caracteres`,
    )
  }

  // Llamada de servidor sin sesión: el plugin admin la permite (es como lo hace su propio CLI).
  const created = await auth.api.createUser({
    body: { email, password, name: args.name, role: 'staff', data: { emailVerified: true } },
  })
  await ensureOrganization(created.user)
  stdout.write(
    `Staff creado: ${email}. Al entrar, activa la verificación en dos pasos en Cuenta → Seguridad.\n`,
  )
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
  .finally(() => void pool.end())
