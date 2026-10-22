import type { components } from './schema'
import { ApiError, record } from './transport'

type Schema = components['schemas']
export type User = Schema['User']
export type AuthResult = Schema['AuthResult']
export type PublicConfig = Schema['PublicConfig']
export type SiteSettings = Schema['SiteSettings']
export type RegistrationSettings = Schema['RegistrationSettings']
export type MailSettings = Schema['MailSettings']
export type SettingsView = Schema['SettingsView']
export type SettingsUpdate = Schema['SettingsUpdate']
export type UserPage = Schema['UserPage']
export type UserDetail = Schema['UserDetail']
export type CreateUserInput = Schema['CreateUserInput']
export type UpdateUserInput = Schema['UpdateUserInput']
export type UpdateSelfInput = Schema['UpdateSelfInput']
export type RegisterInput = Schema['RegisterInput']
export type LoginInput = Schema['LoginInput']
export type PasswordInput = Schema['PasswordInput']
export type AuditPage = Schema['AuditPage']
export type AuditRecord = Schema['AuditRecord']

function text(data: Record<string, unknown>, key: string): string {
  const value = data[key]
  if (typeof value !== 'string') throw new ApiError('RESPONSE_INVALID')
  return value
}
function bool(data: Record<string, unknown>, key: string): boolean {
  const value = data[key]
  if (typeof value !== 'boolean') throw new ApiError('RESPONSE_INVALID')
  return value
}
function number(data: Record<string, unknown>, key: string): number {
  const value = data[key]
  if (typeof value !== 'number' || !Number.isSafeInteger(value))
    throw new ApiError('RESPONSE_INVALID')
  return value
}
function values<T>(data: Record<string, unknown>, key: string, parse: (value: unknown) => T): T[] {
  const value = data[key]
  if (!Array.isArray(value)) throw new ApiError('RESPONSE_INVALID')
  return value.map(parse)
}
function stringValue(value: unknown): string {
  if (typeof value !== 'string') throw new ApiError('RESPONSE_INVALID')
  return value
}
function choice<const T extends readonly string[]>(
  data: Record<string, unknown>,
  key: string,
  choices: T,
): T[number] {
  const value = text(data, key)
  if (!choices.includes(value)) throw new ApiError('RESPONSE_INVALID')
  return value as T[number]
}
function nullableText(data: Record<string, unknown>, key: string): string | null {
  return data[key] === null ? null : text(data, key)
}

export function parseUser(value: unknown): User {
  const data = record(value)
  return {
    id: text(data, 'id'),
    email: text(data, 'email'),
    nickname: text(data, 'nickname'),
    ...(data.avatar_file_id !== undefined
      ? { avatar_file_id: nullableText(data, 'avatar_file_id') }
      : {}),
    role: choice(data, 'role', ['user', 'admin']),
    status: choice(data, 'status', ['active', 'disabled']),
    locale: choice(data, 'locale', ['zh-CN', 'en']),
    timezone: text(data, 'timezone'),
    created_at: text(data, 'created_at'),
    last_login_at: nullableText(data, 'last_login_at'),
    last_login_ip: text(data, 'last_login_ip'),
    ...(data.total_credits !== undefined
      ? {
          permanent_balance: number(data, 'permanent_balance'),
          daily_balance: number(data, 'daily_balance'),
          total_credits: number(data, 'total_credits'),
        }
      : {}),
  }
}
export function parseAuth(value: unknown): AuthResult {
  const data = record(value)
  return {
    access_token: text(data, 'access_token'),
    token_type: choice(data, 'token_type', ['Bearer']),
    expires_in: number(data, 'expires_in'),
    user: parseUser(data.user),
  }
}
export function parseSite(value: unknown): SiteSettings {
  const data = record(value)
  return {
    name: text(data, 'name'),
    description: text(data, 'description'),
    footer: text(data, 'footer'),
    contact: text(data, 'contact'),
    terms_url: text(data, 'terms_url'),
    privacy_url: text(data, 'privacy_url'),
  }
}
export function parsePublic(value: unknown): PublicConfig {
  const data = record(value)
  return {
    site: parseSite(data.site),
    registration_enabled: bool(data, 'registration_enabled'),
    email_verification_enabled: bool(data, 'email_verification_enabled'),
  }
}
function parseRegistration(value: unknown): RegistrationSettings {
  const data = record(value)
  return {
    enabled: bool(data, 'enabled'),
    email_verification_enabled: bool(data, 'email_verification_enabled'),
    domain_allowlist: values(data, 'domain_allowlist', stringValue),
    domain_blocklist: values(data, 'domain_blocklist', stringValue),
    login_failure_limit: number(data, 'login_failure_limit'),
    login_lock_minutes: number(data, 'login_lock_minutes'),
    login_per_minute: number(data, 'login_per_minute'),
    register_per_minute: number(data, 'register_per_minute'),
    code_per_minute: number(data, 'code_per_minute'),
  }
}
function parseMail(value: unknown): MailSettings {
  const data = record(value)
  return {
    host: text(data, 'host'),
    port: number(data, 'port'),
    username: text(data, 'username'),
    from: text(data, 'from'),
    encryption: choice(data, 'encryption', ['starttls', 'tls', 'none']),
    password_configured: bool(data, 'password_configured'),
  }
}
export function parseSettings(value: unknown): SettingsView {
  const data = record(value)
  return {
    site: parseSite(data.site),
    registration: parseRegistration(data.registration),
    mail: parseMail(data.mail),
    env_overrides: values(data, 'env_overrides', stringValue),
  }
}
export function parseUserPage(value: unknown): UserPage {
  const data = record(value)
  return { items: values(data, 'items', parseUser), next_cursor: text(data, 'next_cursor') }
}
export function parseDetail(value: unknown): UserDetail {
  const data = record(value)
  return {
    user: parseUser(data.user),
    sessions: values(data, 'sessions', (value) => {
      const session = record(value)
      return {
        id: text(session, 'id'),
        device: text(session, 'device'),
        ip: text(session, 'ip'),
        user_agent: text(session, 'user_agent'),
        created_at: text(session, 'created_at'),
        expires_at: text(session, 'expires_at'),
        revoked_at: nullableText(session, 'revoked_at'),
      }
    }),
  }
}
function jsonObject(value: unknown): Record<string, unknown> | null {
  return value === null ? null : record(value)
}
function parseAudit(value: unknown): AuditRecord {
  const data = record(value)
  return {
    id: text(data, 'id'),
    actor_id: nullableText(data, 'actor_id'),
    action: text(data, 'action'),
    target_type: text(data, 'target_type'),
    target_id: nullableText(data, 'target_id'),
    before: jsonObject(data.before),
    after: jsonObject(data.after),
    ip: text(data, 'ip'),
    created_at: text(data, 'created_at'),
  }
}
export function parseAuditPage(value: unknown): AuditPage {
  const data = record(value)
  return { items: values(data, 'items', parseAudit), next_cursor: text(data, 'next_cursor') }
}
export function parseCodeSent(value: unknown): number {
  return number(record(value), 'retry_after')
}
