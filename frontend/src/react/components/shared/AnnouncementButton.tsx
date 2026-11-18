import { useCallback, useContext } from 'react'
import { Megaphone } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { AnnouncementsContext } from '../../features/announcements/context'
import { Button } from '../ui/button'

export function AnnouncementButton() {
  const announcements = useContext(AnnouncementsContext)
  const { t } = useTranslation()
  const attach = useCallback(
    (button: HTMLButtonElement | null) => announcements?.setTrigger(button),
    [announcements],
  )
  if (!announcements) return null
  return (
    <Button
      ref={attach}
      type="button"
      variant="ghost"
      size="icon"
      className="shrink-0"
      aria-haspopup="dialog"
      aria-label={t('react.announcementButton')}
      title={t('react.announcementButton')}
      onClick={() => announcements.open()}
    >
      <Megaphone size={18} aria-hidden="true" />
    </Button>
  )
}
