import { describe, expect, it } from 'vitest'
import {
  appendTerminalBuffer,
  containsDomRendererLeak,
  diffTerminalBuffer,
  sanitizeTerminalBuffer
} from '@shared/terminalBuffer'

describe('terminalBuffer', () => {
  it('detects dom renderer css leaks', () => {
    expect(containsDomRendererLeak('.xterm-dom-renderer-owner-4 .xterm-rows span {')).toBe(true)
    expect(containsDomRendererLeak('service-1  | listening on :8080')).toBe(false)
  })

  it('strips leaked css lines from buffers', () => {
    const buffer = [
      'service-1  | ready',
      '.xterm-dom-renderer-owner-4 .xterm-rows span { display: inline-block; }',
      'service-1  | http://localhost:8080'
    ].join('\n')

    expect(sanitizeTerminalBuffer(buffer)).toBe([
      'service-1  | ready',
      'service-1  | http://localhost:8080'
    ].join('\n'))
  })

  it('caps terminal buffers while appending output', () => {
    const chunk = 'x'.repeat(100_000)
    const buffer = appendTerminalBuffer('y'.repeat(100_000), chunk)

    expect(buffer.length).toBeLessThanOrEqual(160_000)
    expect(buffer.endsWith('x'.repeat(60_000))).toBe(true)
  })

  it('diffs a plain append without rewriting the previous buffer', () => {
    expect(diffTerminalBuffer('ready\n', 'ready\nlistening\n')).toEqual({
      mode: 'append',
      chunk: 'listening\n'
    })
  })

  it('appends only the sliding-window tail after the buffer cap', () => {
    const previous = 'y'.repeat(100_000)
    const chunk = 'x'.repeat(100_000)
    const next = appendTerminalBuffer(previous, chunk)

    expect(diffTerminalBuffer(previous, next)).toEqual({
      mode: 'append',
      chunk
    })
  })

  it('appends a small chunk once the stored buffer is already capped', () => {
    const previous = 'a'.repeat(160_000)
    const chunk = 'hello'
    const next = appendTerminalBuffer(previous, chunk)

    expect(diffTerminalBuffer(previous, next)).toEqual({
      mode: 'append',
      chunk
    })
  })

  it('replaces the view when the buffer is cleared or swapped', () => {
    expect(diffTerminalBuffer('old output', '')).toEqual({ mode: 'replace', chunk: '' })
    expect(diffTerminalBuffer('npm run dev\n', 'pnpm test\n')).toEqual({
      mode: 'replace',
      chunk: 'pnpm test\n'
    })
  })
})
