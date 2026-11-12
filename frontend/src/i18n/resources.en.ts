import base from './en'
import accounts from './accounts.en'
import credits from './credits.en'
import catalog from './catalog.en'
import chat from './chat.en'
import images from './images.en'
import operations from './operations.en'

export default {
  ...base,
  ...accounts,
  ...credits,
  ...catalog,
  ...chat,
  ...images,
  ...operations,
  nav: {
    ...accounts.nav,
    ...credits.nav,
    ...catalog.nav,
    ...chat.nav,
    ...images.nav,
    ...operations.nav,
  },
  errors: {
    ...accounts.errors,
    ...credits.errors,
    ...catalog.errors,
    ...chat.errors,
    ...images.errors,
    ...operations.errors,
  },
}
