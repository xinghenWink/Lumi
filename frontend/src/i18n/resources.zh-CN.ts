import base from './zh-CN'
import accounts from './accounts-shell.zh-CN'
import credits from './credits-shell.zh-CN'
import catalog from './catalog-shell.zh-CN'
import chat from './chat.zh-CN'
import images from './images.zh-CN'
import operations from './operations-shell.zh-CN'

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
