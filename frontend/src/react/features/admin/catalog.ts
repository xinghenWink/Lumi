import type { AppRuntime } from '../../app/runtime'
import type {
  ModelInput,
  PlatformModel,
  Upstream,
  UpstreamInput,
} from '../../../api/catalog-contracts'

export function upstreamInput(row: Upstream): UpstreamInput {
  return {
    version: row.version,
    name: row.name,
    base_url: row.base_url,
    timeout_chat_s: row.timeout_chat_s,
    timeout_image_s: row.timeout_image_s,
    proxy_url: row.proxy_url,
    enabled: row.enabled,
    priority: row.priority,
    weight: row.weight,
    edit_format: row.edit_format,
    note: row.note,
  }
}
export function modelInput(row: PlatformModel): ModelInput {
  return {
    version: row.version,
    display_name: row.display_name,
    type: row.type,
    description: row.description,
    icon: row.icon,
    sort_order: row.sort_order,
    enabled: row.enabled,
    is_default: row.is_default,
    capabilities: structuredClone(row.capabilities),
    routes: row.routes.map((route) => ({
      upstream_id: route.upstream_id,
      upstream_model_name: route.upstream_model_name,
      priority: route.priority,
      weight: route.weight,
      enabled: route.enabled,
    })),
  }
}
export function invalidateCatalog(runtime: AppRuntime, owner: string | undefined) {
  for (const kind of ['admin-upstreams', 'admin-models', 'models', 'image-options', 'image-quote'])
    void runtime.queryClient.invalidateQueries({ queryKey: ['user', owner, kind] })
}
