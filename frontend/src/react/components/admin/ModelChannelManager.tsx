import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { catalog } from '../../../api/catalog'
import type {
  UpstreamModelBatchAction,
  UpstreamModelBatchResult,
} from '../../../api/catalog-contracts'
import { useOwnedMutation } from '../../features/accounts/owned-mutation'
import { useChannelChoices } from '../../features/admin/catalog'
import { useSession } from '../../features/auth/hooks'
import { ApiNotice } from '../shared/ApiNotice'
import { Button } from '../ui/button'
import { Field } from '../ui/field'
import { ModalDialog } from '../ui/modal-dialog'
import { NativeSelect, NativeSelectOption } from '../ui/native-select'

const actions = ['enable', 'disable', 'delete'] as const

export function ModelChannelManager({
  channelId,
  onSelect,
  onChanged,
}: {
  channelId: string
  onSelect(id: string): void
  onChanged(): void
}) {
  const { t } = useTranslation()
  const { user } = useSession()
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const channels = useChannelChoices(user?.id)
  const choices = channels.data?.pages.flatMap((page) => page.items) ?? []
  const channel = choices.find((row) => row.id === channelId)
  const [confirm, setConfirm] = useState<{
    action: UpstreamModelBatchAction
    id: string
    name: string
  } | null>(null)
  const [notice, setNotice] = useState<{
    id: string
    result: UpstreamModelBatchResult
  } | null>(null)
  const batch = useOwnedMutation(user?.id, async (check) => {
    if (!confirm) return
    const result = await catalog.batchChannelModels(confirm.id, confirm.action)
    check()
    setNotice({ id: confirm.id, result })
    setConfirm(null)
    onChanged()
  })
  return (
    <section className="mb-5 grid gap-3 rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 basis-56 sm:max-w-80">
          <Field id={id} label={t('catalog.manageByChannel')}>
            <NativeSelect
              id={id}
              value={channelId}
              disabled={channels.isPending || batch.isPending}
              onChange={(event) => {
                setNotice(null)
                onSelect(event.target.value)
              }}
            >
              <NativeSelectOption value="">
                {t(channels.isPending ? 'catalog.loadingChannels' : 'catalog.allChannels')}
              </NativeSelectOption>
              {channelId && !channel ? (
                <NativeSelectOption value={channelId}>
                  {t('catalog.unavailableChannel')}
                </NativeSelectOption>
              ) : null}
              {choices.map((row) => (
                <NativeSelectOption key={row.id} value={row.id}>
                  {row.display_name && row.display_name !== row.name
                    ? t('catalog.channelChoice', { name: row.name, displayName: row.display_name })
                    : row.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
        </div>
        {channels.hasNextPage ? (
          <Button
            variant="outline"
            size="sm"
            disabled={channels.isFetching}
            onClick={() => void channels.fetchNextPage()}
          >
            {t(channels.isFetchingNextPage ? 'catalog.loadingChannels' : 'catalog.moreChannels')}
          </Button>
        ) : null}
        {channel ? (
          <div
            className="flex flex-wrap gap-2"
            role="group"
            aria-label={t('catalog.channelBatchActions')}
          >
            {actions.map((action) => (
              <Button
                key={action}
                variant={action === 'delete' ? 'destructive' : 'outline'}
                size="sm"
                disabled={batch.isPending}
                onClick={(event) => {
                  trigger.current = event.currentTarget
                  batch.reset()
                  setConfirm({ action, id: channel.id, name: channel.name })
                }}
              >
                {t(`catalog.channelBatch.${action}`)}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
      {channels.isError ? (
        <div className="grid justify-items-start gap-2">
          <ApiNotice error={channels.error} />
          <Button variant="outline" size="sm" onClick={() => void channels.refetch()}>
            {t('common.retry')}
          </Button>
        </div>
      ) : null}
      {!channels.isPending && !channels.isError && !choices.length ? (
        <p className="text-xs text-muted-foreground">{t('catalog.noChannels')}</p>
      ) : null}
      {notice?.id === channelId ? (
        <p role="status" className="text-xs text-primary">
          {t('catalog.channelBatchResult', {
            exclusive: notice.result.affected_exclusive_models,
            shared: notice.result.affected_shared_models,
          })}
        </p>
      ) : null}
      <ModalDialog
        open={!!confirm}
        onOpenChange={(open) => {
          if (!open) setConfirm(null)
        }}
        title={confirm ? t(`catalog.channelBatch.${confirm.action}`) : ''}
        description={
          confirm ? t(`catalog.channelBatchHint.${confirm.action}`, { name: confirm.name }) : ''
        }
        busy={batch.isPending}
        returnFocus={trigger}
        className="wrap-anywhere"
      >
        <div className="grid gap-3">
          <ApiNotice error={batch.error} />
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" disabled={batch.isPending} onClick={() => setConfirm(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant={confirm?.action === 'delete' ? 'destructive' : 'default'}
              disabled={batch.isPending}
              onClick={() => batch.mutate()}
            >
              {t(batch.isPending ? 'catalog.channelBatchPending' : 'catalog.channelBatchConfirm')}
            </Button>
          </div>
        </div>
      </ModalDialog>
    </section>
  )
}
