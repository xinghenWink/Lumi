import { lazy, Suspense, type ReactNode } from 'react'
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { PublicShell } from '../layouts/PublicShell'
import { AdminBoundary, GuestBoundary, SessionBoundary } from '../features/auth/guards'
import { adminGroups } from '../features/accounts/navigation'

const AuthPage = lazy(() => import('../pages/AuthPage'))
const ResetPasswordPage = lazy(() => import('../pages/ResetPasswordPage'))
const LegalPage = lazy(() => import('../pages/LegalPage'))
const NotFoundPage = lazy(() => import('../pages/NotFoundPage'))
const ImagePage = lazy(() => import('../pages/ImagePage'))
const ImageGalleryPage = lazy(() => import('../pages/ImageGalleryPage'))
const CreditsPage = lazy(() => import('../pages/CreditsPage'))
const ProfilePage = lazy(() => import('../pages/ProfilePage'))
const SecurityPage = lazy(() => import('../pages/SecurityPage'))
const ChatPage = lazy(() => import('../pages/ChatPage'))
const ChatHistoryPage = lazy(() => import('../pages/ChatHistoryPage'))
const SectionPage = lazy(() => import('../pages/SectionPage'))
const UsersPage = lazy(() => import('../pages/admin/UsersPage'))
const UserDetailPage = lazy(() => import('../pages/admin/UserDetailPage'))
const CreditLedgerPage = lazy(() => import('../pages/admin/CreditLedgerPage'))
const RedeemCodesPage = lazy(() => import('../pages/admin/RedeemCodesPage'))
const UpstreamsPage = lazy(() => import('../pages/admin/UpstreamsPage'))
const ModelsPage = lazy(() => import('../pages/admin/ModelsPage'))
const ChatSettingsPage = lazy(() => import('../pages/admin/ChatSettingsPage'))
const ImageSettingsPage = lazy(() => import('../pages/admin/ImageSettingsPage'))
const ImageTasksPage = lazy(() => import('../pages/admin/ImageTasksPage'))
const PricingPage = lazy(() => import('../pages/admin/PricingPage'))
const WorkspaceShell = lazy(() =>
  import('../layouts/WorkspaceShell').then((module) => ({ default: module.WorkspaceShell })),
)
const AdminShell = lazy(() =>
  import('../layouts/AdminShell').then((module) => ({ default: module.AdminShell })),
)
function LoadingPage() {
  const { t } = useTranslation()
  return (
    <div className="grid flex-1 place-items-center py-10" role="status">
      {t('common.loading')}
    </div>
  )
}

function pending(page: ReactNode) {
  return <Suspense fallback={<LoadingPage />}>{page}</Suspense>
}

const router = createBrowserRouter([
  { path: '/', element: <Navigate to="/chat" replace /> },
  {
    element: <PublicShell />,
    children: [
      {
        element: <GuestBoundary />,
        children: [
          { path: '/login', element: pending(<AuthPage />) },
          { path: '/register', element: pending(<AuthPage />) },
        ],
      },
      { path: '/forgot-password', element: pending(<ResetPasswordPage key="forgot" />) },
      { path: '/reset-password', element: pending(<ResetPasswordPage key="reset" />) },
      { path: '/terms', element: pending(<LegalPage />) },
      { path: '/privacy', element: pending(<LegalPage />) },
      { path: '*', element: pending(<NotFoundPage />) },
    ],
  },
  {
    element: <SessionBoundary />,
    children: [
      {
        element: pending(<WorkspaceShell />),
        children: [
          ...['/chat', '/chat/:id'].map((path) => ({ path, element: pending(<ChatPage />) })),
          ...['/create', '/create/:id'].map((path) => ({
            path,
            element: pending(<ImagePage />),
          })),
          { path: '/me/chats', element: pending(<ChatHistoryPage />) },
          { path: '/me/images', element: pending(<ImageGalleryPage />) },
          { path: '/me', element: pending(<ProfilePage />) },
          { path: '/me/security', element: pending(<SecurityPage />) },
          { path: '/me/credits', element: pending(<CreditsPage />) },
        ],
      },
      {
        element: <AdminBoundary />,
        children: [
          {
            element: pending(<AdminShell />),
            children: [
              { path: '/admin', element: <Navigate to="/admin/dashboard" replace /> },
              ...adminGroups
                .flatMap((group) => group.items)
                .map(({ path }) => ({
                  path: path === '/admin/settings' ? '/admin/settings/:group?' : path,
                  element: pending(
                    path === '/admin/users' ? (
                      <UsersPage />
                    ) : path === '/admin/credit-ledger' ? (
                      <CreditLedgerPage />
                    ) : path === '/admin/redeem-codes' ? (
                      <RedeemCodesPage />
                    ) : path === '/admin/upstreams' ? (
                      <UpstreamsPage />
                    ) : path === '/admin/models' ? (
                      <ModelsPage />
                    ) : path === '/admin/chat-settings' ? (
                      <ChatSettingsPage />
                    ) : path === '/admin/image-settings' ? (
                      <ImageSettingsPage />
                    ) : path === '/admin/image-tasks' ? (
                      <ImageTasksPage />
                    ) : path === '/admin/pricing' ? (
                      <PricingPage />
                    ) : (
                      <SectionPage />
                    ),
                  ),
                })),
              { path: '/admin/users/:id', element: pending(<UserDetailPage />) },
            ],
          },
        ],
      },
    ],
  },
])

export function AppRouter() {
  return <RouterProvider router={router} />
}
