import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/chat' },
    {
      path: '/login',
      name: 'login',
      component: () => import('../pages/AuthPage.vue'),
      meta: { guest: true },
    },
    {
      path: '/register',
      name: 'register',
      component: () => import('../pages/AuthPage.vue'),
      meta: { guest: true },
    },
    { path: '/terms', name: 'terms', component: () => import('../pages/LegalPage.vue') },
    { path: '/privacy', name: 'privacy', component: () => import('../pages/LegalPage.vue') },
    {
      path: '/',
      component: () => import('./AppShell.vue'),
      meta: { requiresAuth: true },
      children: [
        {
          path: 'chat',
          name: 'workspace',
          component: () => import('../pages/WorkspacePage.vue'),
          meta: { title: 'nav.workspace' },
        },
        {
          path: 'me',
          name: 'profile',
          component: () => import('../pages/ProfilePage.vue'),
          meta: { title: 'nav.account' },
        },
        { path: 'admin', redirect: '/admin/users', meta: { admin: true } },
        {
          path: 'me/credits',
          name: 'credits',
          component: () => import('../pages/CreditsPage.vue'),
          meta: { title: 'nav.credits' },
        },
        {
          path: 'admin/pricing',
          name: 'pricing',
          component: () => import('../pages/admin/PricingPage.vue'),
          meta: { admin: true, title: 'nav.pricing' },
        },
        {
          path: 'admin/redeem-codes',
          name: 'redeem-codes',
          component: () => import('../pages/admin/RedeemCodesPage.vue'),
          meta: { admin: true, title: 'nav.redeemCodes' },
        },
        {
          path: 'admin/credit-ledger',
          name: 'credit-ledger',
          component: () => import('../pages/admin/CreditLedgerPage.vue'),
          meta: { admin: true, title: 'nav.creditLedger' },
        },
        {
          path: 'admin/users',
          name: 'users',
          component: () => import('../pages/admin/UsersPage.vue'),
          meta: { admin: true, title: 'nav.users' },
        },
        {
          path: 'admin/users/:id',
          name: 'user-detail',
          component: () => import('../pages/admin/UserDetailPage.vue'),
          meta: { admin: true, title: 'nav.users' },
        },
        {
          path: 'admin/settings/:group?',
          name: 'settings',
          component: () => import('../pages/admin/SettingsPage.vue'),
          meta: { admin: true, title: 'nav.settings' },
        },
        {
          path: 'admin/audit',
          name: 'audit',
          component: () => import('../pages/admin/AuditPage.vue'),
          meta: { admin: true, title: 'nav.audit' },
        },
      ],
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('../pages/NotFoundPage.vue'),
    },
  ],
})

router.beforeEach(async (to) => {
  if (!to.meta.requiresAuth && !to.meta.guest) return true
  const auth = useAuthStore()
  await auth.bootstrap()
  if (to.meta.requiresAuth && !auth.user) return { name: 'login', query: { redirect: to.fullPath } }
  if (to.meta.admin && auth.user?.role !== 'admin') return { name: 'workspace' }
  if (to.meta.guest && auth.user) return { name: 'workspace' }
  return true
})
