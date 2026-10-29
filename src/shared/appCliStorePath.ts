import { realpathSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

/** Canonicalize aliases even before a new store file has been created. */
export function canonicalAppStorePath(value: string) {
  const path = resolve(value)
  try {
    return realpathSync(path)
  } catch {
    try {
      return join(realpathSync(dirname(path)), basename(path))
    } catch {
      return path
    }
  }
}

export function sameAppStorePath(left: string, right: string) {
  const a = canonicalAppStorePath(left)
  const b = canonicalAppStorePath(right)
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}
