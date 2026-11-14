import { useMutation } from '@tanstack/react-query'
import { Globe } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { accounts } from '../../../api/accounts'
import type { User } from '../../../api/contracts'
import { useRuntime } from '../../app/context'
import { assertOwnership } from '../../features/accounts/owned-mutation'
import { Button } from '../ui/button'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '../ui/dropdown-menu'
import { ApiNotice } from './ApiNotice'

const languages = [
  { locale: 'zh-CN', label: 'common.zhCN' },
  { locale: 'en', label: 'common.en' },
] as const

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation()
  const runtime = useRuntime()
  const current = i18n.resolvedLanguage === 'en' ? languages[1] : languages[0]
  const save = useMutation({
    scope: { id: 'profile' },
    mutationFn: async (selection: { locale: User['locale']; owner: string; epoch: number }) => {
      assertOwnership(runtime.session, selection)
      // Load the lazy catalog before committing the account preference.
      if (!i18n.exists('react.changeLanguage', { lng: selection.locale })) {
        await i18n.reloadResources([selection.locale], ['translation'])
        if (!i18n.exists('react.changeLanguage', { lng: selection.locale }))
          throw new Error('Could not load the selected language')
      }
      assertOwnership(runtime.session, selection)
      const user = await accounts.updateMe({ locale: selection.locale })
      assertOwnership(runtime.session, selection)
      runtime.session.updateUser(user)
    },
  })

  function selectLanguage(locale: User['locale']) {
    const { user, epoch } = runtime.session.getSnapshot()
    if (user && locale !== current.locale && !save.isPending)
      save.mutate({ locale, owner: user.id, epoch })
  }

  return (
    <div className="relative shrink-0">
      <DropdownMenu
        modal={false}
        onOpenChange={(open) => {
          if (open && save.isError) save.reset()
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            className="w-10 px-0 sm:w-auto sm:px-3"
            aria-label={t('react.languageSelection', { language: t(current.label) })}
            aria-busy={save.isPending}
          >
            <Globe size={18} data-icon="inline-start" aria-hidden="true" />
            <span lang={current.locale} className="hidden sm:inline">
              {t(current.label)}
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={6} collisionPadding={12}>
          <DropdownMenuRadioGroup value={current.locale}>
            {languages.map(({ locale, label }) => (
              <DropdownMenuRadioItem
                key={locale}
                value={locale}
                lang={locale}
                disabled={save.isPending}
                onSelect={() => selectLanguage(locale)}
              >
                {t(label)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {save.isError ? (
        <div className="absolute top-full right-0 z-50 mt-2 w-56">
          <ApiNotice error={save.error} />
        </div>
      ) : null}
    </div>
  )
}
