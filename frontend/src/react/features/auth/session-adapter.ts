import { createSessionService } from '../../../api/auth-session'

// One SPA composition root owns this instance; tests instantiate their own service.
export const session = createSessionService()
export const getSession = () => session
