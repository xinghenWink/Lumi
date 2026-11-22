import { useTranslation } from 'react-i18next'

export function AdminUserInfo({
  user_id,
  user_nickname,
  user_email,
}: {
  user_id: string
  user_nickname?: string
  user_email?: string
}) {
  const { t } = useTranslation()
  return (
    <div className="min-w-36 max-w-64 leading-5 wrap-anywhere">
      {user_nickname ? <strong className="block">{user_nickname}</strong> : null}
      {user_email ? <span className="block text-muted-foreground">{user_email}</span> : null}
      {user_nickname || user_email ? null : (
        <span className="block text-muted-foreground">{t('common.none')}</span>
      )}
      <code className="block text-[10px] text-muted-foreground">{user_id}</code>
    </div>
  )
}
