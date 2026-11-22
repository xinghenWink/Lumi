import { useId, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ChevronsUpDown, Plus, Trash2 } from 'lucide-react'
import { credits } from '../../../api/credits'
import { imageResolutions } from '../../../api/image-resolutions'
import type { CreditPricing, CreditRule } from '../../../api/credit-contracts'
import { imageQualities } from '../../../api/image-quality'
import { ApiError } from '../../../api/transport'
import { useRuntime } from '../../app/context'
import { useSession } from '../../features/auth/hooks'
import { useOwnedMutation } from '../../features/accounts/owned-mutation'
import { listPricingModels } from '../../features/admin/catalog'
import { AdminPage } from '../../components/admin/AdminPage'
import { NumberField } from '../../components/admin/AdminFields'
import { PricingModelDetails, PricingModelPicker } from '../../components/admin/PricingModelPicker'
import { Panel } from '../../components/shared/Panel'
import { PageStatus } from '../../components/shared/PageStatus'
import { ApiNotice } from '../../components/shared/ApiNotice'
import { Field, FieldGroup, selectClass } from '../../components/ui/field'
import { Input } from '../../components/ui/input'
import { Button } from '../../components/ui/button'

type RuleDraft = Omit<CreditRule, 'credits_per_image' | 'operation' | 'quality'> & {
  credits_per_image: string
  operation: CreditRule['operation'] | ''
  quality: CreditRule['quality'] | ''
}
const maxPricingRules = 504
const ruleDrafts = (value: CreditPricing): RuleDraft[] => {
  const global = value.rules
    .filter((row) => row.model_id === null)
    .sort(
      (left, right) =>
        left.operation.localeCompare(right.operation) ||
        imageQualities.indexOf(left.quality) - imageQualities.indexOf(right.quality),
    )
  return [...global, ...value.rules.filter((row) => row.model_id !== null)].map((row) => ({
    ...row,
    credits_per_image: String(row.credits_per_image),
  }))
}
function PricingForm({ initial }: { initial: CreditPricing }) {
  const runtime = useRuntime(),
    { user } = useSession(),
    { t } = useTranslation(),
    id = useId()
  const [configuration, setConfiguration] = useState(() => structuredClone(initial.configuration)),
    [rules, setRules] = useState(() => ruleDrafts(initial)),
    [notice, setNotice] = useState(false)
  const [pickerIndex, setPickerIndex] = useState<number | null>(null)
  const modelTrigger = useRef<HTMLButtonElement>(null)
  const models = useQuery({
    queryKey: ['user', user?.id, 'admin-models', 'pricing'],
    enabled: !!user && (pickerIndex !== null || rules.some((rule) => !!rule.model_id)),
    queryFn: ({ signal }) => listPricingModels(signal),
  })
  const modelsById = useMemo(
    () => new Map(models.data?.map((model) => [model.id, model])),
    [models.data],
  )
  const activeRule = pickerIndex === null ? undefined : rules[pickerIndex]
  const updateRule = (index: number, patch: Partial<RuleDraft>) =>
    setRules((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  const save = useOwnedMutation(user?.id, async (check) => {
    const body: CreditPricing = {
      configuration: {
        ...configuration,
        credits_timezone: configuration.credits_timezone.trim(),
        edit_multiplier: configuration.edit_multiplier.trim(),
        size_multipliers: {
          '1k': configuration.size_multipliers['1k'].trim(),
          '2k': configuration.size_multipliers['2k'].trim(),
          '4k': configuration.size_multipliers['4k'].trim(),
        },
      },
      rules: rules.map((row) => {
        const amount = Number(row.credits_per_image)
        if (row.model_id === '') throw new ApiError('PRICING_MODEL_REQUIRED')
        if (
          !row.credits_per_image.trim() ||
          !Number.isSafeInteger(amount) ||
          amount < 0 ||
          amount > 1e9 ||
          (row.operation !== 'generate' && row.operation !== 'edit') ||
          !row.quality
        )
          throw new ApiError('INVALID_INPUT')
        return {
          ...row,
          operation: row.operation,
          quality: row.quality,
          credits_per_image: amount,
        }
      }),
    }
    const result = await credits.savePricing(body)
    check()
    setConfiguration(result.configuration)
    setRules(ruleDrafts(result))
    setNotice(true)
    runtime.queryClient.setQueryData(['user', user?.id, 'admin-pricing'], result)
    for (const kind of ['credits', 'admin-users', 'image-quote', 'image-options'])
      void runtime.queryClient.invalidateQueries({ queryKey: ['user', user?.id, kind] })
  })
  return (
    <form
      className="grid gap-5"
      onSubmit={(event) => {
        event.preventDefault()
        setNotice(false)
        save.mutate()
      }}
    >
      <fieldset disabled={save.isPending} className="grid min-w-0 gap-5">
        <Panel title={t('credits.gifts')} description={t('credits.giftHint')}>
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField
              label={t('credits.signupBonus')}
              value={configuration.signup_bonus_credits}
              max={1e9}
              onChange={(signup_bonus_credits) =>
                setConfiguration({ ...configuration, signup_bonus_credits })
              }
            />
            <NumberField
              label={t('credits.dailyGrant')}
              value={configuration.daily_free_credits}
              max={1e9}
              onChange={(daily_free_credits) =>
                setConfiguration({ ...configuration, daily_free_credits })
              }
            />
            <Field id={id + '-timezone'} label={t('credits.creditsTimezone')}>
              <Input
                id={id + '-timezone'}
                value={configuration.credits_timezone}
                maxLength={100}
                required
                onChange={(event) =>
                  setConfiguration({ ...configuration, credits_timezone: event.target.value })
                }
              />
            </Field>
            <Field id={id + '-edit'} label={t('credits.editMultiplier')}>
              <Input
                id={id + '-edit'}
                value={configuration.edit_multiplier}
                inputMode="decimal"
                maxLength={8}
                required
                onChange={(event) =>
                  setConfiguration({ ...configuration, edit_multiplier: event.target.value })
                }
              />
            </Field>
          </div>
        </Panel>
        <Panel title={t('credits.rules')} description={t('credits.priceHint')}>
          <div className="mb-4 flex justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={rules.length >= maxPricingRules}
              onClick={() =>
                setRules([
                  ...rules,
                  {
                    model_id: '',
                    operation: '',
                    quality: '',
                    credits_per_image: '',
                    enabled: true,
                  },
                ])
              }
            >
              <Plus size={15} />
              {t('credits.addRule')}
            </Button>
          </div>
          <div className="overflow-x-auto overscroll-x-contain">
            <table className="w-full text-left text-xs">
              <thead>
                <tr>
                  {['pricingModel', 'operation', 'quality', 'unitPrice', 'enabled'].map((key) => (
                    <th
                      key={key}
                      scope="col"
                      className="whitespace-nowrap px-3 py-2 text-muted-foreground"
                    >
                      {t(`credits.${key}`)}
                    </th>
                  ))}
                  <th scope="col" className="px-3 py-2 text-muted-foreground">
                    {t('common.actions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule, index) => (
                  <tr key={index} className="border-t border-border">
                    <td className="min-w-60 p-3">
                      {rule.model_id === null ? (
                        <span className="rounded bg-accent px-2 py-1 text-primary">
                          {t('credits.global')}
                        </span>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          aria-haspopup="dialog"
                          aria-label={t(
                            rule.model_id
                              ? 'credits.changePricingModel'
                              : 'credits.selectPricingModel',
                          )}
                          className="h-auto min-h-10 w-full justify-between gap-3 px-3 py-2"
                          onClick={(event) => {
                            modelTrigger.current = event.currentTarget
                            setPickerIndex(index)
                          }}
                        >
                          {rule.model_id ? (
                            <PricingModelDetails
                              modelId={rule.model_id}
                              model={modelsById.get(rule.model_id)}
                              catalogLoaded={!!models.data}
                            />
                          ) : (
                            <span className="text-muted-foreground">
                              {t('credits.selectPricingModel')}
                            </span>
                          )}
                          <ChevronsUpDown aria-hidden="true" size={16} />
                        </Button>
                      )}
                    </td>
                    <td className="min-w-28 p-3">
                      {rule.model_id === null ? (
                        t(`credits.${rule.operation}`)
                      ) : (
                        <select
                          className={selectClass}
                          required
                          value={rule.operation}
                          aria-label={t('credits.operation')}
                          onChange={(event) =>
                            updateRule(index, {
                              operation:
                                event.target.value === 'edit'
                                  ? 'edit'
                                  : event.target.value === 'generate'
                                    ? 'generate'
                                    : '',
                            })
                          }
                        >
                          <option value="">{t('common.none')}</option>
                          {['generate', 'edit'].map((value) => (
                            <option key={value} value={value}>
                              {t(`credits.${value}`)}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td className="min-w-28 p-3">
                      {rule.model_id === null ? (
                        t(`credits.${rule.quality}`)
                      ) : (
                        <select
                          className={selectClass}
                          required
                          value={rule.quality}
                          aria-label={t('credits.quality')}
                          onChange={(event) =>
                            updateRule(index, {
                              quality:
                                imageQualities.find((value) => value === event.target.value) ?? '',
                            })
                          }
                        >
                          <option value="">{t('common.none')}</option>
                          {imageQualities.map((value) => (
                            <option key={value} value={value}>
                              {t(`credits.${value}`)}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td className="min-w-28 p-3">
                      <Input
                        type="number"
                        min={0}
                        max={1e9}
                        step={1}
                        required
                        value={rule.credits_per_image}
                        aria-label={
                          t('credits.unitPrice') +
                          ' ' +
                          (rule.operation ? t(`credits.${rule.operation}`) : '') +
                          ' ' +
                          (rule.quality ? t(`credits.${rule.quality}`) : '')
                        }
                        onChange={(event) =>
                          updateRule(index, { credits_per_image: event.target.value })
                        }
                      />
                    </td>
                    <td className="p-3">
                      <input
                        type="checkbox"
                        checked={rule.enabled}
                        aria-label={
                          t('credits.enabled') +
                          ' ' +
                          (rule.operation ? t(`credits.${rule.operation}`) : '') +
                          ' ' +
                          (rule.quality ? t(`credits.${rule.quality}`) : '')
                        }
                        onChange={(event) => updateRule(index, { enabled: event.target.checked })}
                      />
                    </td>
                    <td className="p-3">
                      {rule.model_id === null ? null : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={t('credits.removeRule')}
                          className="text-destructive"
                          onClick={() => setRules((rows) => rows.filter((_, i) => i !== index))}
                        >
                          <Trash2 size={15} />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel
          title={t('credits.resolutionMultipliers')}
          description={t('credits.resolutionMultiplierHint')}
        >
          <FieldGroup className="grid sm:grid-cols-3">
            {imageResolutions.map((resolution) => (
              <Field
                key={resolution}
                id={id + '-' + resolution}
                label={t('images.resolutionTier.' + resolution)}
              >
                <Input
                  id={id + '-' + resolution}
                  value={configuration.size_multipliers[resolution]}
                  inputMode="decimal"
                  maxLength={8}
                  required
                  onChange={(event) =>
                    setConfiguration({
                      ...configuration,
                      size_multipliers: {
                        ...configuration.size_multipliers,
                        [resolution]: event.target.value,
                      },
                    })
                  }
                />
              </Field>
            ))}
          </FieldGroup>
        </Panel>
      </fieldset>
      {activeRule?.model_id != null && pickerIndex !== null ? (
        <PricingModelPicker
          models={models.data}
          error={models.error}
          selected={activeRule.model_id}
          returnFocus={modelTrigger}
          onRetry={() => void models.refetch()}
          onSelect={(model_id) => {
            updateRule(pickerIndex, { model_id })
            setPickerIndex(null)
          }}
          onClose={() => setPickerIndex(null)}
        />
      ) : null}
      <ApiNotice error={save.error} />
      {notice ? (
        <p role="status" className="text-xs text-primary">
          {t('credits.pricingSaved')}
        </p>
      ) : null}
      <div className="flex justify-end">
        <Button type="submit" disabled={save.isPending}>
          {t('credits.savePricing')}
        </Button>
      </div>
    </form>
  )
}
export default function PricingPage() {
  const { user } = useSession(),
    { t } = useTranslation()
  const query = useQuery({
    queryKey: ['user', user?.id, 'admin-pricing'],
    enabled: !!user,
    queryFn: ({ signal }) => credits.pricing(signal),
    staleTime: 0,
  })
  return (
    <AdminPage title={t('credits.pricingTitle')} description={t('credits.pricingDescription')}>
      {query.data ? (
        <PricingForm initial={query.data} />
      ) : (
        <PageStatus
          {...(query.error ? { error: query.error } : {})}
          retry={() => {
            void query.refetch()
          }}
        />
      )}
    </AdminPage>
  )
}
