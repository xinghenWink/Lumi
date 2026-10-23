import { getSession } from '@lumi/session'
import { createAuthorizedClient } from './session'

const client = createAuthorizedClient(getSession)
export const authorized = client.authorized
export const authorizedResponse = client.authorizedResponse
