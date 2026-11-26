import { useStore } from 'zustand'
import { Image, MessageSquare, Video } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useRuntime } from '../../app/context'

export function ModeTabs() {
  const { t } = useTranslation()
  const runtime = useRuntime()
  const path = useLocation().pathname
  const lastChat = useStore(runtime.chat.store, (state) => state.lastOpened)
  const imageConversation = useStore(runtime.imageNavigation, (state) => state.lastOpened)
  return (
    <nav
      aria-label={t('chat.mode')}
      className="flex shrink-0 gap-0.5 rounded-full border border-border bg-muted/60 p-0.5 text-xs"
    >
      {[
        { to: lastChat ? '/chat/' + lastChat : '/chat', key: 'chat.chatMode', icon: MessageSquare },
        {
          to: imageConversation ? '/create/' + imageConversation : '/create',
          key: 'chat.imageMode',
          icon: Image,
        },
        { to: '/video', key: 'video.short', icon: Video },
      ].map(({ to, key, icon: Icon }) => {
        const active = path.split('/')[1] === to.split('/')[1]
        return (
          <Link
            key={key}
            to={to}
            aria-current={active ? 'page' : undefined}
            className={
              'flex h-8 items-center gap-1.5 rounded-full px-3.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring ' +
              (active
                ? 'bg-card font-medium text-foreground shadow-xs [&_svg]:text-primary'
                : 'text-muted-foreground hover:text-foreground')
            }
          >
            <Icon size={14} />
            {t(key)}
          </Link>
        )
      })}
    </nav>
  )
}
