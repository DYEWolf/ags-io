/** Separa `Nombre <correo@dominio>` en sus partes; acepta también un correo suelto. */
export function parseAddress(value: string): { name: string; email: string } {
  const match = /^\s*(.*?)\s*<\s*([^>]+?)\s*>\s*$/.exec(value)
  if (match?.[2]) return { name: match[1] ?? '', email: match[2] }
  return { name: '', email: value.trim() }
}
