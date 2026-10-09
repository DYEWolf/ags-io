// Plantillas de correo transaccional. Texto plano + HTML mínimo y compatible con clientes de correo.
import type { EmailJobData } from '~/queue/email'

type Rendered = Omit<EmailJobData, 'to'>

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => `&#${String(char.charCodeAt(0))};`)

function layout(options: {
  title: string
  intro: string
  action: string
  url: string
  outro: string
}) {
  const { title, intro, action, url, outro } = options
  const html = `<!doctype html>
<html lang="es"><body style="margin:0;background:#f4f4f5;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#18181b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#fff;border-radius:8px;padding:32px">
<tr><td>
<p style="margin:0 0 24px;font-weight:600">ags-io</p>
<h1 style="margin:0 0 16px;font-size:20px">${escapeHtml(title)}</h1>
<p style="margin:0 0 24px;line-height:1.5">${escapeHtml(intro)}</p>
<p style="margin:0 0 24px"><a href="${escapeHtml(url)}" style="display:inline-block;background:#18181b;color:#fff;text-decoration:none;padding:12px 20px;border-radius:6px">${escapeHtml(action)}</a></p>
<p style="margin:0 0 8px;font-size:13px;color:#52525b">Si el botón no funciona, copia este enlace:</p>
<p style="margin:0 0 24px;font-size:13px;word-break:break-all"><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>
<p style="margin:0;font-size:13px;color:#52525b;line-height:1.5">${escapeHtml(outro)}</p>
</td></tr></table></td></tr></table></body></html>`
  const text = `${title}\n\n${intro}\n\n${action}: ${url}\n\n${outro}\n`
  return { html, text }
}

export function verifyEmailTemplate(url: string): Rendered {
  return {
    template: 'verify-email',
    subject: 'Confirma tu correo en ags-io',
    ...layout({
      title: 'Confirma tu correo',
      intro: 'Para activar tu cuenta de ags-io, confirma que este correo es tuyo.',
      action: 'Confirmar correo',
      url,
      outro: 'El enlace caduca en 1 hora. Si no creaste esta cuenta, ignora este mensaje.',
    }),
  }
}

export function changeEmailTemplate(url: string, newEmail: string): Rendered {
  return {
    template: 'change-email',
    subject: 'Confirma tu nuevo correo en ags-io',
    ...layout({
      title: 'Confirma tu nuevo correo',
      intro: `Pediste usar ${newEmail} como correo de tu cuenta de ags-io. Confírmalo para completar el cambio.`,
      action: 'Confirmar nuevo correo',
      url,
      outro: 'El enlace caduca en 1 hora. Si no pediste este cambio, ignora este mensaje.',
    }),
  }
}

export function resetPasswordTemplate(url: string): Rendered {
  return {
    template: 'reset-password',
    subject: 'Restablece tu contraseña de ags-io',
    ...layout({
      title: 'Restablece tu contraseña',
      intro: 'Recibimos una solicitud para restablecer la contraseña de tu cuenta de ags-io.',
      action: 'Elegir nueva contraseña',
      url,
      outro:
        'El enlace sirve una sola vez y caduca en 1 hora. Al cambiarla se cerrarán tus otras sesiones. Si no lo pediste, ignora este mensaje: tu contraseña no cambia.',
    }),
  }
}

export function existingAccountTemplate(url: string): Rendered {
  return {
    template: 'existing-account',
    subject: 'Intento de registro con tu correo en ags-io',
    ...layout({
      title: 'Ya tienes una cuenta',
      intro:
        'Alguien intentó crear una cuenta de ags-io con este correo, que ya está registrado. Si fuiste tú, inicia sesión o recupera tu contraseña.',
      action: 'Iniciar sesión',
      url,
      outro: 'Si no fuiste tú, puedes ignorar este mensaje; tu cuenta no ha cambiado.',
    }),
  }
}

export function confirmEmailChangeTemplate(url: string, newEmail: string): Rendered {
  return {
    template: 'confirm-email-change',
    subject: 'Aprueba el cambio de correo de tu cuenta de ags-io',
    ...layout({
      title: 'Aprueba el cambio de correo',
      intro: `Se pidió cambiar el correo de tu cuenta de ags-io a ${newEmail}. Apruébalo desde aquí y después confirma el nuevo correo con el enlace que te enviaremos.`,
      action: 'Aprobar cambio',
      url,
      outro:
        'El enlace caduca en 1 hora. Si no pediste este cambio, ignora este mensaje y cambia tu contraseña.',
    }),
  }
}
