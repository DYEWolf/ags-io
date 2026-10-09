/** 23505 = unique_violation. Drizzle envuelve el error de pg en `cause`. */
export function isUniqueViolation(error: unknown): boolean {
  const cause = error instanceof Error && error.cause ? error.cause : error
  return typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === '23505'
}
