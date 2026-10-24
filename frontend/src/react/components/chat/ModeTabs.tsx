import { useStore } from 'zustand'
import { MessageSquare, Sparkles } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useRuntime } from '../../app/context'

export function ModeTabs({ imageConversation = '' }: { imageConversation?: string }) {
  const { t } = useTranslation()
  const runtime = useRuntime()
  const image = useLocation().pathname.startsWith('/create')
  const lastChat = useStore(runtime.chat.store, (state) => state.lastOpened)
  return (
    <nav
      aria-label={t('chat.mode')}
      className="flex shrink-0 gap-1 rounded-xl bg-muted p-1 text-xs"
    >
      {[
        { to: lastChat ? '/chat/' + lastChat : '/chat', key: 'chat.chatMode', icon: MessageSquare },
        {
          to: imageConversation ? '/create/' + imageConversation : '/create',
          key: 'chat.imageMode',
          icon: Sparkles,
        },
      ].map(({ to, key, icon: Icon }) => (
        <Link
          key={key}
          to={to}
          aria-current={image === (key === 'chat.imageMode') ? 'page' : undefined}
          className={`flex items-center gap-2 rounded-lg px-3 py-2 ${image === (key === 'chat.imageMode') ? 'bg-card font-medium text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
        >
          <Icon size={14} />
          {t(key)}
        </Link>
      ))}
    </nav>
  )
}
