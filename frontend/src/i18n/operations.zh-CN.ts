import shared from './operations-shell.zh-CN'
import admin from './operations-admin.zh-CN'

export default {
  ...shared,
  ops: { ...shared.ops, ...admin },
}
