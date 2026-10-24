import { Moon, Sun } from 'lucide-react'
import { useStore } from 'zustand'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useRuntime } from '../../app/context'
import { operations } from '../../../api/operations'
import { ApiError } from '../../../api/transport'
import { effectiveTheme, type Theme } from '../../stores/theme'
import { Button } from '../ui/button'

export function ThemeToggle() {
  const runtime = useRuntime()
  const current = useStore(runtime.themeStore, effectiveTheme)
  const { t } = useTranslation()
  const save = useMutation({
    scope: { id: 'appearance' },
    mutationFn: async ({ theme, epoch }: { theme: Theme; epoch: number }) => {
      if (runtime.session.snapshot().epoch !== epoch) throw new ApiError('AUTH_REQUIRED', 401)
      const preferences = await operations.preferences()
      if (runtime.session.snapshot().epoch !== epoch) throw new ApiError('AUTH_REQUIRED', 401)
      const saved = await operations.savePreferences({ ...preferences, theme })
      const state = runtime.session.getSnapshot()
      if (state.epoch === epoch)
        runtime.queryClient.setQueryData(['user', state.user?.id, 'preferences'], saved)
    },
  })
  function toggle() {
    const theme = current === 'dark' ? 'light' : 'dark'
    runtime.themeStore.getState().setTheme(theme)
    const snapshot = runtime.session.getSnapshot()
    // Appearance remains immediately usable when optional preference persistence is offline.
    if (snapshot.user) save.mutate({ theme, epoch: snapshot.epoch })
  }
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={t(current === 'dark' ? 'common.themeLight' : 'common.themeDark')}
      onClick={toggle}
    >
      {current === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
    </Button>
  )
}
