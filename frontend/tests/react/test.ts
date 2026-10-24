import { randomBytes, randomUUID } from 'node:crypto'
import { test as base, expect } from '@playwright/test'
import { record } from '../../src/api/transport'
import { journeyHeaders } from './client-headers'

// Each journey represents an independent administrator and keeps the real per-user write quota.
export const test = base.extend<{ isolatedAdministrator: boolean }>({
  extraHTTPHeaders: async ({ baseURL }, use, info) => {
    if (!baseURL) throw new Error('Missing real server URL')
    await use(journeyHeaders(info))
  },
  isolatedAdministrator: [
    async ({ request, baseURL }, use) => {
      const originalEmail = process.env.E2E_ADMIN_EMAIL,
        originalPassword = process.env.E2E_ADMIN_PASSWORD
      if (!originalEmail || !originalPassword || !baseURL)
        throw new Error('Missing real bootstrap administrator')
      const headers = { 'X-Lumi-CSRF': '1', Origin: baseURL }
      const login = await request.post('/api/v1/auth/login', {
        headers,
        data: { email: originalEmail, password: originalPassword },
      })
      expect(login.ok(), 'Bootstrap login status ' + login.status()).toBe(true)
      const auth = record(await login.json())
      if (typeof auth.access_token !== 'string') throw new Error('Missing bootstrap access token')
      const authorized = { ...headers, Authorization: 'Bearer ' + auth.access_token }
      const email = 'journey-' + randomUUID() + '@lumi.test',
        password = randomBytes(24).toString('base64url') + 'Aa1'
      const created = await request.post('/api/v1/admin/users', {
        headers: authorized,
        data: {
          email,
          password,
          nickname: 'Journey administrator',
          role: 'admin',
          initial_credits: 0,
        },
      })
      expect(created.ok(), 'Journey administrator creation status ' + created.status()).toBe(true)
      const user = record(await created.json())
      if (typeof user.id !== 'string') throw new Error('Missing journey administrator ID')
      process.env.E2E_ADMIN_EMAIL = email
      process.env.E2E_ADMIN_PASSWORD = password
      try {
        await use(true)
      } finally {
        process.env.E2E_ADMIN_EMAIL = originalEmail
        process.env.E2E_ADMIN_PASSWORD = originalPassword
        const deleted = await request.delete('/api/v1/admin/users/' + user.id, {
          headers: authorized,
          data: { email },
        })
        expect(deleted.ok()).toBe(true)
      }
    },
    { auto: true },
  ],
})
export { expect }
export type { Browser, Page, TestInfo } from '@playwright/test'
