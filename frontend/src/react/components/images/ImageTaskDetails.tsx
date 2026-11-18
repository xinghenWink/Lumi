import { useTranslation } from 'react-i18next'
import type { ImageTask } from '../../../api/images'
import { useTime } from '../../features/accounts/time'
import { ReferenceChips } from './ReferenceChips'

export function ImageTaskDetails({
  task,
  showInput = false,
}: {
  task: ImageTask
  showInput?: boolean
}) {
  const { t } = useTranslation()
  const time = useTime()
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3 text-xs">
        {[
          ['images.task', task.id],
          ...(showInput ? [] : [['images.user', task.user_id]]),
          ['images.created', time(task.created_at)],
          [
            'images.operation',
            t(task.operation === 'edit' ? 'images.editOperation' : 'images.generate'),
          ],
          ['images.status', t('images.' + task.status)],
        ].map(([label, value]) => (
          <div className="contents" key={label}>
            <dt className="text-muted-foreground">{t(label ?? '')}</dt>
            <dd className="break-all">{value}</dd>
          </div>
        ))}
      </dl>
      {showInput && task.content_visible ? (
        <>
          <div>
            <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">
              {t('images.fullPrompt')}
            </h3>
            <p className="text-sm leading-6 wrap-anywhere whitespace-pre-wrap select-text">
              {task.prompt}
            </p>
          </div>
          <div>
            <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">
              {t('images.references')}
            </h3>
            {task.reference_file_ids.length ? (
              <ReferenceChips ids={task.reference_file_ids} previewable={false} />
            ) : (
              <p className="text-sm text-muted-foreground">{t('common.none')}</p>
            )}
          </div>
        </>
      ) : null}
      <div className="flex flex-col gap-2 text-xs tabular-nums">
        <p>
          {t('images.actual', { cost: task.actual_cost })} ·{' '}
          {t('images.refund', { cost: task.refunded_cost })}
        </p>
        {task.started_at && task.finished_at ? (
          <p className="text-muted-foreground">
            {t('images.duration', {
              seconds: Math.max(
                0,
                (Date.parse(task.finished_at) - Date.parse(task.started_at)) / 1000,
              ).toFixed(1),
            })}
          </p>
        ) : null}
      </div>
    </div>
  )
}
