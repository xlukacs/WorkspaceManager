import { describe, expect, it } from 'vitest'
import { joinPaths, normalizePath } from '@shared/pathUtils'

describe('pathUtils', () => {
  it('normalizes posix paths', () => {
    expect(normalizePath('/tmp/demo/../demo/apps/web')).toBe('/tmp/demo/apps/web')
  })

  it('normalizes windows paths', () => {
    expect(normalizePath('C:\\repos\\demo\\.\\apps\\web')).toBe('C:\\repos\\demo\\apps\\web')
  })

  it('joins paths with a consistent separator', () => {
    expect(joinPaths('C:\\repos\\demo', 'apps', 'web')).toBe('C:\\repos\\demo\\apps\\web')
  })
})
