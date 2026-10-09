// Hash de contraseñas con argon2id (R-001). Parámetros: recomendación de OWASP para argon2id
// (19 MiB, 2 iteraciones, 1 hilo), que caben holgadamente en los 384 MiB del contenedor web.
import { hash, verify, type Algorithm } from '@node-rs/argon2'

const ARGON2ID = 2 satisfies Algorithm.Argon2id

const options = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
}

export function hashPassword(password: string): Promise<string> {
  return hash(password, options)
}

export function verifyPassword({ hash: digest, password }: { hash: string; password: string }) {
  // Los parámetros se leen del propio hash, así que subirlos en el futuro no rompe los existentes.
  return verify(digest, password)
}
