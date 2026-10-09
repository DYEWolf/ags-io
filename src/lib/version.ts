// Versión desplegada: la inyecta el build de la imagen (APP_VERSION = SHA del commit).
export const APP_VERSION = process.env['APP_VERSION'] ?? 'dev'
