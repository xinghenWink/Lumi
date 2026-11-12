import base from './zh-CN'
import accounts from './accounts.zh-CN'
import credits from './credits.zh-CN'
import catalog from './catalog.zh-CN'
import chat from './chat.zh-CN'
import images from './images.zh-CN'
import operations from './operations.zh-CN'

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
