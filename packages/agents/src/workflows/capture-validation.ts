/** Reply checks shared by the publishing gate and the capture executor. */
export const CAPTURE_VALIDATIONS = ['', 'required', 'text', 'date', 'time', 'phone', 'number', 'email', 'yes_no'] as const

export function validCapturedReply(validation: string, raw: string): boolean {
  const value = raw.trim()
  if (!value) return false
  switch (validation) {
    case 'date': {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
      const parsed = new Date(`${value}T00:00:00Z`)
      return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    }
    case 'time': {
      const match = value.match(/^(\d{1,2}):(\d{2})$/)
      return Boolean(match && Number(match[1]) <= 23 && Number(match[2]) <= 59)
    }
    case 'phone':
      return /^\+?[1-9]\d{7,14}$/.test(value.replace(/[\s().-]/g, ''))
    case 'yes_no':
      return /^(yes|no|y|n|si|sí|confirm|cancel|confirmo|cancelar)$/i.test(value)
    case 'email':
      // A syntax check only; delivery and mailbox ownership are not verified.
      return /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(value)
    case 'number':
      return /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value) && Number.isFinite(Number(value))
    case '':
    case 'text':
    case 'required':
      return value.length > 0
    default:
      return false
  }
}
