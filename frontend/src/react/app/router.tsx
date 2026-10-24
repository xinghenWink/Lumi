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
const WorkspaceHome = lazy(() => import('../pages/WorkspaceHome'))
const ChatPage = lazy(() => import('../pages/ChatPage'))
const ChatHistoryPage = lazy(() => import('../pages/ChatHistoryPage'))
const SectionPage = lazy(() => import('../pages/SectionPage'))
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
            element: pending(<WorkspaceHome />),
          })),
          { path: '/me/chats', element: pending(<ChatHistoryPage />) },
          ...['/me', '/me/security', '/me/images', '/me/credits'].map((path) => ({
            path,
            element: pending(<SectionPage />),
          })),
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
                  element: pending(<SectionPage />),
                })),
              { path: '/admin/users/:id', element: pending(<SectionPage />) },
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
