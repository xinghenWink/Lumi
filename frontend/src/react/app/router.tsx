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
const DashboardPage = lazy(() => import('../pages/admin/DashboardPage'))
const ConversationsPage = lazy(() => import('../pages/admin/ConversationsPage'))
const AnnouncementsPage = lazy(() => import('../pages/admin/AnnouncementsPage'))
const OperationsSettingsPage = lazy(() => import('../pages/admin/OperationsSettingsPage'))
const SystemPage = lazy(() => import('../pages/admin/SystemPage'))
const SettingsPage = lazy(() => import('../pages/admin/SettingsPage'))
const AuditPage = lazy(() => import('../pages/admin/AuditPage'))
const WorkspaceShell = lazy(() =>
  import('../layouts/WorkspaceShell').then((module) => ({ default: module.WorkspaceShell })),
)
const AdminShell = lazy(() =>
  import('../layouts/AdminShell').then((module) => ({ default: module.AdminShell })),
)
const adminPages: Record<string, ReactNode> = {
  '/admin/users': <UsersPage />,
  '/admin/credit-ledger': <CreditLedgerPage />,
  '/admin/redeem-codes': <RedeemCodesPage />,
  '/admin/upstreams': <UpstreamsPage />,
  '/admin/models': <ModelsPage />,
  '/admin/chat-settings': <ChatSettingsPage />,
  '/admin/image-settings': <ImageSettingsPage />,
  '/admin/image-tasks': <ImageTasksPage />,
  '/admin/pricing': <PricingPage />,
  '/admin/dashboard': <DashboardPage />,
  '/admin/conversations': <ConversationsPage />,
  '/admin/announcements': <AnnouncementsPage />,
  '/admin/operations-settings': <OperationsSettingsPage />,
  '/admin/system': <SystemPage />,
  '/admin/settings': <SettingsPage />,
  '/admin/audit': <AuditPage />,
}
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
                  element: pending(adminPages[path] ?? <NotFoundPage />),
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
