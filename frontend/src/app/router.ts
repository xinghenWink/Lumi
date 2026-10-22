import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/chat' },
    {
      path: '/forgot-password',
      name: 'forgot-password',
      component: () => import('../pages/ResetPasswordPage.vue'),
    },
    {
      path: '/reset-password',
      name: 'reset-password',
      component: () => import('../pages/ResetPasswordPage.vue'),
    },
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
          path: 'me/security',
          name: 'security',
          component: () => import('../pages/SecurityPage.vue'),
          meta: { title: 'nav.security' },
        },
        ...(
          [
            ['dashboard', 'admin-dashboard', 'nav.dashboard'],
            ['announcements', 'admin-announcements', 'nav.announcements'],
            ['system', 'admin-system', 'nav.systemInfo'],
            ['operations-settings', 'admin-operations', 'nav.operations'],
            ['conversations', 'admin-chats', 'nav.adminChats'],
          ] as const
        ).map(([path, name, title]) => ({
          path: 'admin/' + path,
          name,
          component: () => import('../pages/admin/OperationsPage.vue'),
          meta: { admin: true, title },
        })),
        {
          path: 'chat',
          name: 'workspace',
          component: () => import('../pages/ChatPage.vue'),
          meta: { title: 'nav.workspace' },
        },
        {
          path: 'me',
          name: 'profile',
          component: () => import('../pages/ProfilePage.vue'),
          meta: { title: 'nav.account' },
        },
        {
          path: 'create',
          name: 'image-workspace',
          component: () => import('../pages/ImagePage.vue'),
          meta: { title: 'nav.create' },
        },
        {
          path: 'create/:id',
          name: 'image-conversation',
          component: () => import('../pages/ImagePage.vue'),
          meta: { title: 'nav.create' },
        },
        {
          path: 'me/images',
          name: 'image-gallery',
          component: () => import('../pages/ImageGalleryPage.vue'),
          meta: { title: 'nav.gallery' },
        },
        {
          path: 'admin/image-tasks',
          name: 'image-tasks',
          component: () => import('../pages/admin/ImageTasksPage.vue'),
          meta: { admin: true, title: 'nav.imageTasks' },
        },
        {
          path: 'admin/image-settings',
          name: 'image-settings',
          component: () => import('../pages/admin/ImageSettingsPage.vue'),
          meta: { admin: true, title: 'nav.imageSettings' },
        },
        {
          path: 'chat/:id',
          name: 'conversation',
          component: () => import('../pages/ChatPage.vue'),
          meta: { title: 'nav.chat' },
        },
        {
          path: 'me/chats',
          name: 'chat-history',
          component: () => import('../pages/ChatHistoryPage.vue'),
          meta: { title: 'nav.chatHistory' },
        },
        {
          path: 'admin/chat-settings',
          name: 'chat-settings',
          component: () => import('../pages/admin/ChatSettingsPage.vue'),
          meta: { admin: true, title: 'nav.chatSettings' },
        },
        {
          path: 'admin/upstreams',
          name: 'upstreams',
          component: () => import('../pages/admin/UpstreamsPage.vue'),
          meta: { admin: true, title: 'nav.upstreams' },
        },
        {
          path: 'admin/models',
          name: 'models',
          component: () => import('../pages/admin/ModelsPage.vue'),
          meta: { admin: true, title: 'nav.models' },
        },
        { path: 'admin', redirect: '/admin/dashboard', meta: { admin: true } },
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
