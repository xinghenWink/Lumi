import type { components } from './schema'
import { parseImageQuality } from './image-quality'
import { imageResolutions } from './image-resolutions'
import { ApiError, record } from './transport'
type Schema = components['schemas']
export type CreditAccount = Schema['CreditAccount']
export type CreditPricing = Omit<Schema['CreditPricing'], 'configuration'> & {
  configuration: CreditConfiguration
}
export type CreditRule = Schema['CreditPricingRule']
export type CreditConfiguration = Required<Schema['CreditConfiguration']>
export type Referral = Schema['Referral']
export type CreditAdjustInput = Schema['CreditAdjustInput']
export type CreditLedgerPage = Schema['CreditLedgerPage']
export type CreditUsage = Schema['CreditUsage']
export type RedeemRecordPage = Schema['RedeemRecordPage']
export type RedeemBatch = Schema['RedeemBatch']
export type RedeemBatchInput = Schema['RedeemBatchInput']
export type RedeemBatchPage = Schema['RedeemBatchPage']
export type RedeemCode = Schema['RedeemCode']
export type RedeemCodePage = Schema['RedeemCodePage']

function text(data: Record<string, unknown>, key: string): string {
  const value = data[key]
  if (typeof value !== 'string') throw new ApiError('RESPONSE_INVALID')
  return value
}
function number(data: Record<string, unknown>, key: string, negative = false): number {
  const value = data[key]
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || (!negative && value < 0))
    throw new ApiError('RESPONSE_INVALID')
  return value
}
function bool(data: Record<string, unknown>, key: string): boolean {
  if (typeof data[key] !== 'boolean') throw new ApiError('RESPONSE_INVALID')
  return data[key]
}
function nullable(data: Record<string, unknown>, key: string): string | null {
  return data[key] === null ? null : text(data, key)
}
function referralAmount(data: Record<string, unknown>, key: string): number {
  const amount = number(data, key)
  if (amount > 1e9) throw new ApiError('RESPONSE_INVALID')
  return amount
}
function list<T>(data: Record<string, unknown>, key: string, parse: (value: unknown) => T): T[] {
  const value = data[key]
  if (!Array.isArray(value)) throw new ApiError('RESPONSE_INVALID')
  return value.map(parse)
}
function choice<const T extends readonly string[]>(
  data: Record<string, unknown>,
  key: string,
  choices: T,
): T[number] {
  const value = text(data, key)
  if (!choices.includes(value)) throw new ApiError('RESPONSE_INVALID')
  return value as T[number]
}
export function parseCreditAccount(value: unknown): CreditAccount {
  const data = record(value)
  const permanent = number(data, 'permanent_balance'),
    daily = number(data, 'daily_balance'),
    total = number(data, 'total')
  if (permanent > 1e12 || daily > 1e12 || total !== permanent + daily)
    throw new ApiError('RESPONSE_INVALID')
  return {
    user_id: text(data, 'user_id'),
    permanent_balance: permanent,
    daily_balance: daily,
    total,
    daily_reset_on: text(data, 'daily_reset_on'),
    next_reset_at: text(data, 'next_reset_at'),
    timezone: text(data, 'timezone'),
    version: number(data, 'version'),
  }
}
function parseConfiguration(value: unknown): CreditConfiguration {
  const data = record(value),
    sizes = record(data.size_multipliers)
  if (Object.keys(sizes).length !== imageResolutions.length) throw new ApiError('RESPONSE_INVALID')
  return {
    signup_bonus_credits: number(data, 'signup_bonus_credits'),
    referral_inviter_bonus_credits:
      data.referral_inviter_bonus_credits === undefined
        ? 0
        : referralAmount(data, 'referral_inviter_bonus_credits'),
    referral_invitee_bonus_credits:
      data.referral_invitee_bonus_credits === undefined
        ? 0
        : referralAmount(data, 'referral_invitee_bonus_credits'),
    daily_free_credits: number(data, 'daily_free_credits'),
    credits_timezone: text(data, 'credits_timezone'),
    edit_multiplier: text(data, 'edit_multiplier'),
    size_multipliers: { '1k': text(sizes, '1k'), '2k': text(sizes, '2k'), '4k': text(sizes, '4k') },
  }
}
function parseRule(value: unknown): CreditRule {
  const data = record(value)
  return {
    model_id: nullable(data, 'model_id'),
    operation: choice(data, 'operation', ['generate', 'edit']),
    quality: parseImageQuality(data.quality),
    credits_per_image: number(data, 'credits_per_image'),
    enabled: bool(data, 'enabled'),
  }
}
export function parsePricing(value: unknown): CreditPricing {
  const data = record(value)
  return {
    rules: list(data, 'rules', parseRule),
    configuration: parseConfiguration(data.configuration),
  }
}
export function parseReferral(value: unknown): Referral {
  const data = record(value)
  const code = text(data, 'invite_code')
  const link = text(data, 'invite_url')
  if ((code && !/^[A-F0-9]{16}$/.test(code)) || Boolean(code) !== Boolean(link))
    throw new ApiError('RESPONSE_INVALID')
  return {
    invite_code: code,
    invite_url: link,
    referral_inviter_bonus_credits: referralAmount(data, 'referral_inviter_bonus_credits'),
    referral_invitee_bonus_credits: referralAmount(data, 'referral_invitee_bonus_credits'),
  }
}
export function parseLedger(value: unknown): CreditLedgerPage {
  const data = record(value)
  return {
    next_cursor: text(data, 'next_cursor'),
    items: list(data, 'items', (value) => {
      const row = record(value)
      return {
        id: text(row, 'id'),
        user_id: text(row, 'user_id'),
        type: choice(row, 'type', [
          'signup_bonus',
          'referral_inviter_bonus',
          'referral_invitee_bonus',
          'daily_grant',
          'daily_expire',
          'redeem',
          'admin_adjust',
          'image_charge',
          'image_refund',
        ]),
        bucket: choice(row, 'bucket', ['daily', 'permanent']),
        delta: number(row, 'delta', true),
        bucket_balance_after: number(row, 'bucket_balance_after'),
        total_after: number(row, 'total_after'),
        ref_type: text(row, 'ref_type'),
        ref_id: nullable(row, 'ref_id'),
        operator_id: nullable(row, 'operator_id'),
        note: text(row, 'note'),
        created_at: text(row, 'created_at'),
      }
    }),
  }
}
export function parseUsage(value: unknown): CreditUsage {
  const data = record(value),
    images = record(data.images_by_quality)
  const days = list(data, 'days', (value) => {
    const day = record(value)
    return { date: text(day, 'date'), consumed: number(day, 'consumed') }
  })
  if (days.length !== 30) throw new ApiError('RESPONSE_INVALID')
  return {
    days,
    month_consumed: number(data, 'month_consumed'),
    timezone: text(data, 'timezone'),
    images_by_quality: {
      low: number(images, 'low'),
      medium: number(images, 'medium'),
      high: number(images, 'high'),
      xhigh: images.xhigh === undefined ? 0 : number(images, 'xhigh'),
      max: images.max === undefined ? 0 : number(images, 'max'),
    },
  }
}
function parseRedemption(value: unknown): Schema['RedeemRecord'] {
  const data = record(value)
  return {
    id: text(data, 'id'),
    code_id: text(data, 'code_id'),
    user_id: text(data, 'user_id'),
    code_tail: text(data, 'code_tail'),
    credits: number(data, 'credits'),
    created_at: text(data, 'created_at'),
    ...(data.ip !== undefined ? { ip: text(data, 'ip') } : {}),
  }
}
export function parseRedemptions(value: unknown): RedeemRecordPage {
  const data = record(value)
  return { items: list(data, 'items', parseRedemption), next_cursor: text(data, 'next_cursor') }
}
export function parseRedeemed(value: unknown): Schema['RedeemResult'] {
  const data = record(value)
  return {
    credits: number(data, 'credits'),
    account: parseCreditAccount(data.account),
    record: parseRedemption(data.record),
  }
}
export function parseBatch(value: unknown): RedeemBatch {
  const data = record(value)
  return {
    id: text(data, 'id'),
    name: text(data, 'name'),
    note: text(data, 'note'),
    prefix: text(data, 'prefix'),
    quantity: number(data, 'quantity'),
    credits: number(data, 'credits'),
    max_uses: number(data, 'max_uses'),
    expires_at: nullable(data, 'expires_at'),
    created_at: text(data, 'created_at'),
  }
}
export function parseBatches(value: unknown): RedeemBatchPage {
  const data = record(value)
  return { items: list(data, 'items', parseBatch), next_cursor: text(data, 'next_cursor') }
}
export function parseCodes(value: unknown): RedeemCodePage {
  const data = record(value)
  return {
    next_cursor: text(data, 'next_cursor'),
    items: list(data, 'items', (value) => {
      const row = record(value)
      return {
        id: text(row, 'id'),
        batch_id: text(row, 'batch_id'),
        code: text(row, 'code'),
        tail: text(row, 'tail'),
        credits: number(row, 'credits'),
        max_uses: number(row, 'max_uses'),
        used_count: number(row, 'used_count'),
        enabled: bool(row, 'enabled'),
        status: choice(row, 'status', ['unused', 'used', 'expired', 'disabled']),
        expires_at: nullable(row, 'expires_at'),
        created_at: text(row, 'created_at'),
      }
    }),
  }
}
