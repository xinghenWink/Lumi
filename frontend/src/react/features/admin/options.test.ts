import { describe, expect, it } from 'vitest'
import { parseRatioMapping } from './options'

describe('image ratio configuration input', () => {
  it('rejects ambiguous duplicate keys after whitespace normalization', () => {
    expect(() => parseRatioMapping('1:1=1024x1024\n 1:1 = auto')).toThrow('INVALID_INPUT')
    expect(() => parseRatioMapping('1:1=1024x1024=auto')).toThrow('INVALID_INPUT')
    expect(() => parseRatioMapping('1:1=')).toThrow('INVALID_INPUT')
    expect(parseRatioMapping(' 1:1 = 1024x1024\n\n9:16=1024x1536 ')).toEqual({
      '1:1': '1024x1024',
      '9:16': '1024x1536',
    })
  })
})
