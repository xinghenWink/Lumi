import { authorized } from './protected'
import { noContent } from './transport'
import {
  parseUpstream,
  parseUpstreams,
  parseModels,
  parseModel,
  parseDiscovery,
  parseConnectionTest,
  parsePublicCatalog,
  parseImportResult,
  type UpstreamInput,
  type ModelInput,
  type ImportInput,
  type ModelKind,
} from './catalog-contracts'
const root = '/api/v1/admin'
const options = (signal?: AbortSignal) => (signal ? { signal } : {})
const channel = (id: string) => `${root}/upstreams/${encodeURIComponent(id)}`
const model = (id: string) => `${root}/models/${encodeURIComponent(id)}`
export const catalog = {
  channels: (query: URLSearchParams, signal?: AbortSignal) =>
    authorized(`${root}/upstreams?${query}`, parseUpstreams, options(signal)),
  saveChannel: (body: UpstreamInput, id?: string) =>
    authorized(id ? channel(id) : `${root}/upstreams`, parseUpstream, {
      method: id ? 'PUT' : 'POST',
      body,
    }),
  deleteChannel: (id: string) => authorized(channel(id), noContent, { method: 'DELETE' }),
  test: (id: string) => authorized(`${channel(id)}/test`, parseConnectionTest, { method: 'POST' }),
  discover: (id: string, signal?: AbortSignal) =>
    authorized(`${channel(id)}/discover`, parseDiscovery, { method: 'POST', ...options(signal) }),
  import: (id: string, body: ImportInput) =>
    authorized(`${channel(id)}/import`, parseImportResult, { method: 'POST', body }),
  models: (query: URLSearchParams, signal?: AbortSignal) =>
    authorized(`${root}/models?${query}`, parseModels, options(signal)),
  saveModel: (body: ModelInput, id?: string) =>
    authorized(id ? model(id) : `${root}/models`, parseModel, {
      method: id ? 'PUT' : 'POST',
      body,
    }),
  deleteModel: (id: string) => authorized(model(id), noContent, { method: 'DELETE' }),
  public: (kind: ModelKind, signal?: AbortSignal) =>
    authorized(`/api/v1/models?type=${kind}`, parsePublicCatalog, options(signal)),
}
