import {
  BarChart3,
  Bell,
  Boxes,
  ClipboardList,
  Coins,
  Image,
  MessageSquare,
  Server,
  Settings2,
  Shield,
  Ticket,
  Users,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

interface NavigationGroup {
  key: string
  items: { path: string; key: string; icon: LucideIcon }[]
}
export const adminGroups: NavigationGroup[] = [
  {
    key: 'react.adminOverview',
    items: [{ path: '/admin/dashboard', key: 'nav.dashboard', icon: BarChart3 }],
  },
  {
    key: 'react.adminUsers',
    items: [
      { path: '/admin/users', key: 'nav.users', icon: Users },
      { path: '/admin/credit-ledger', key: 'nav.creditLedger', icon: Coins },
      { path: '/admin/redeem-codes', key: 'nav.redeemCodes', icon: Ticket },
    ],
  },
  {
    key: 'react.adminAI',
    items: [
      { path: '/admin/upstreams', key: 'nav.upstreams', icon: Server },
      { path: '/admin/models', key: 'nav.models', icon: Boxes },
      { path: '/admin/chat-settings', key: 'nav.chatSettings', icon: MessageSquare },
      { path: '/admin/image-tasks', key: 'nav.imageTasks', icon: Image },
      { path: '/admin/image-settings', key: 'nav.imageSettings', icon: Settings2 },
      { path: '/admin/pricing', key: 'nav.pricing', icon: Coins },
    ],
  },
  {
    key: 'react.adminOperations',
    items: [
      { path: '/admin/conversations', key: 'nav.adminChats', icon: MessageSquare },
      { path: '/admin/announcements', key: 'nav.announcements', icon: Bell },
      { path: '/admin/settings', key: 'nav.settings', icon: Settings2 },
      { path: '/admin/operations-settings', key: 'nav.operations', icon: Shield },
      { path: '/admin/system', key: 'nav.systemInfo', icon: Server },
      { path: '/admin/audit', key: 'nav.audit', icon: ClipboardList },
    ],
  },
]

export function routeTitle(path: string): string {
  const admin = adminGroups
    .flatMap((group) => group.items)
    .find((item) => path === item.path || path.startsWith(item.path + '/'))
  if (admin) return admin.key
  if (path.startsWith('/create')) return 'nav.image'
  if (path.startsWith('/me/images')) return 'nav.gallery'
  if (path.startsWith('/me/chats')) return 'nav.chatHistory'
  if (path.startsWith('/me/credits')) return 'nav.credits'
  if (path.startsWith('/me/security')) return 'nav.security'
  if (path === '/me') return 'nav.account'
  return 'nav.chat'
}
