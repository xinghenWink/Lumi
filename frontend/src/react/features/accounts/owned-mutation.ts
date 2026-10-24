import { useMutation } from '@tanstack/react-query'
import type { SessionService } from '../../../api/auth-session'
import { ApiError } from '../../../api/transport'
import { useRuntime } from '../../app/context'

export function assertOwnership(
  session: SessionService,
  stamp: { owner: string | undefined; epoch: number },
) {
  const current = session.getSnapshot()
  if (!stamp.owner || stamp.owner !== current.user?.id || stamp.epoch !== current.epoch)
    throw new ApiError('AUTH_REQUIRED', 401)
}
export function useOwnedMutation<T>(
  owner: string | undefined,
  run: (check: () => void) => Promise<T>,
  options?: { scope?: string; endsSession?: boolean },
) {
  const runtime = useRuntime()
  const mutation = useMutation({
    ...(options?.scope ? { scope: { id: options.scope } } : {}),
    mutationFn: async (stamp: { owner: string | undefined; epoch: number }) => {
      const check = () => assertOwnership(runtime.session, stamp)
      check()
      const result = await run(check)
      if (!options?.endsSession) check()
      return result
    },
  })
  // Only ownership metadata enters mutation variables, never passwords or provider secrets.
  const stamp = () => ({ owner, epoch: runtime.session.snapshot().epoch })
  return {
    ...mutation,
    mutate: () => mutation.mutate(stamp()),
    mutateAsync: () => mutation.mutateAsync(stamp()),
  }
}
