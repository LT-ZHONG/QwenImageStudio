import { describe, expect, it } from 'vitest'
import { formatBytes, formatTime, STATUS_LABEL } from './format'

describe('formatBytes', () => {
  it('scales units', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.00 MB')
  })
})

describe('formatTime', () => {
  it('treats timestamps without a zone as UTC (SQLite returns naive datetimes)', () => {
    expect(formatTime('2026-11-25T12:20:56.867133')).toBe(formatTime('2026-11-25T12:20:56.867133Z'))
  })
  it('keeps explicit offsets and handles null', () => {
    expect(new Date('2026-11-25T20:00:00+08:00').getTime()).toBe(new Date('2026-11-25T12:00:00Z').getTime())
    expect(formatTime('2026-11-25T20:00:00+08:00')).toBe(formatTime('2026-11-25T12:00:00Z'))
    expect(formatTime(null)).toBe('—')
  })
})

describe('STATUS_LABEL', () => {
  it('covers every backend task status', () => {
    for (const s of ['queued', 'submitting', 'running', 'cancelling', 'succeeded', 'failed', 'cancelled'])
      expect(STATUS_LABEL[s]).toBeTruthy()
  })
})
