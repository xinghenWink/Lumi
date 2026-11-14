import type { TFunction, i18n as I18n } from 'i18next'
import { ApiError } from '../../api/transport'

/** Same mapping as ApiNotice, for compact surfaces such as tooltips. */
export function errorText(t: TFunction, i18n: I18n, error: unknown) {
  const api = error instanceof ApiError ? error : undefined
  return t(api && i18n.exists('errors.' + api.code) ? 'errors.' + api.code : 'errors.UNKNOWN_ERROR')
}
