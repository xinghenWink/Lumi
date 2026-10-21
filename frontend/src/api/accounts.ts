import { authorized } from './protected'
import { noContent } from './transport'
import {
  parseUser,
  parseUserPage,
  parseDetail,
  parseSettings,
  parseAuditPage,
  type CreateUserInput,
  type UpdateUserInput,
  type UpdateSelfInput,
  type PasswordInput,
  type SettingsUpdate,
} from './contracts'

const userPath = (id: string) => `/api/v1/admin/users/${encodeURIComponent(id)}`
export const accounts = {
  list: (query: URLSearchParams, signal?: AbortSignal) =>
    authorized(`/api/v1/admin/users?${query}`, parseUserPage, signal ? { signal } : {}),
  detail: (id: string, signal?: AbortSignal) =>
    authorized(userPath(id), parseDetail, signal ? { signal } : {}),
  create: (body: CreateUserInput) =>
    authorized('/api/v1/admin/users', parseUser, { method: 'POST', body }),
  update: (id: string, body: UpdateUserInput) =>
    authorized(userPath(id), parseUser, { method: 'PATCH', body }),
  delete: (id: string, email: string) =>
    authorized(userPath(id), noContent, { method: 'DELETE', body: { email } }),
  updateMe: (body: UpdateSelfInput) =>
    authorized('/api/v1/me', parseUser, { method: 'PATCH', body }),
  password: (body: PasswordInput) =>
    authorized('/api/v1/me/password', noContent, { method: 'POST', body }),
  settings: (group: string, signal?: AbortSignal) =>
    authorized(
      `/api/v1/admin/settings/${encodeURIComponent(group)}`,
      parseSettings,
      signal ? { signal } : {},
    ),
  saveSettings: (group: string, body: SettingsUpdate) =>
    authorized(`/api/v1/admin/settings/${encodeURIComponent(group)}`, parseSettings, {
      method: 'PUT',
      body,
    }),
  audit: (query: URLSearchParams, signal?: AbortSignal) =>
    authorized(`/api/v1/admin/audit-logs?${query}`, parseAuditPage, signal ? { signal } : {}),
}
