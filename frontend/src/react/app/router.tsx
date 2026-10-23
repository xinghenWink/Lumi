import { lazy, Suspense } from 'react'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

const FoundationPage = lazy(() => import('../pages/FoundationPage'))
function LoadingPage() {
  const { t } = useTranslation()
  return (
    <div className="grid min-h-dvh place-items-center" role="status">
      {t('common.loading')}
    </div>
  )
}

const router = createBrowserRouter([
  {
    path: '*',
    element: (
      <Suspense fallback={<LoadingPage />}>
        <FoundationPage />
      </Suspense>
    ),
  },
])

export function AppRouter() {
  return <RouterProvider router={router} />
}
