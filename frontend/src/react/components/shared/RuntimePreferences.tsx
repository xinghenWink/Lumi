import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { userPreferences } from '../../../api/preferences'
import { useRuntime } from '../../app/context'
import { useSession } from '../../features/auth/hooks'

export function RuntimePreferences() {
  const runtime = useRuntime()
  const { user, epoch } = useSession()
  const preferences = useQuery({
    queryKey: ['user', user?.id, 'preferences'],
    enabled: !!user,
    queryFn: ({ signal }) => userPreferences.get(signal),
    staleTime: Infinity,
  })
  useEffect(() => {
    if (preferences.data && runtime.session.snapshot().epoch === epoch)
      runtime.themeStore.getState().setTheme(preferences.data.theme)
  }, [preferences.data, runtime, epoch])
  return null
}
