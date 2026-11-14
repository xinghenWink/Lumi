import adminZh from './accounts-admin.zh-CN'
import catalogAdminZh from './catalog-admin.zh-CN'
import legalZh from './legal.zh-CN'
import creditsZh from './credits.zh-CN'
import operationsZh from './operations.zh-CN'
import zhCN from './resources.zh-CN'
import en from './resources.en'

// Kept for parity tests; the app bundles zh-CN and loads English on demand.
export const messages = {
  'zh-CN': {
    ...zhCN,
    ...adminZh,
    ...legalZh,
    credits: creditsZh.credits,
    ops: operationsZh.ops,
    catalog: { ...zhCN.catalog, ...catalogAdminZh.catalog },
  },
  en,
}
