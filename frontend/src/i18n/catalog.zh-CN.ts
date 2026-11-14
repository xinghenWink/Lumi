import shell from './catalog-shell.zh-CN'
import admin from './catalog-admin.zh-CN'

export default { ...shell, catalog: { ...shell.catalog, ...admin.catalog } }
