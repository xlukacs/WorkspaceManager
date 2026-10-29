/** Path helpers with no Node builtins (safe for renderer + main). */

function usesBackslashSeparator(...paths: string[]) {
  return paths.some((path) => /\\/.test(path) || /^[A-Za-z]:/.test(path))
}

function toSlashSegments(path: string) {
  const driveMatch = path.match(/^([A-Za-z]:)(.*)$/)
  const drive = driveMatch?.[1] ?? ''
  const remainder = driveMatch ? driveMatch[2] : path
  const isAbsolute = remainder.startsWith('/') || Boolean(drive)
  const segments: string[] = []

  for (const part of remainder.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (segments.length > 0) segments.pop()
      continue
    }
    segments.push(part)
  }

  return { drive, isAbsolute, segments }
}

export function normalizePath(input: string) {
  if (!input) return '.'
  const useBackslash = usesBackslashSeparator(input)
  const separator = useBackslash ? '\\' : '/'
  const { drive, isAbsolute, segments } = toSlashSegments(input)
  const joined = segments.join(separator)

  if (drive) {
    return joined ? `${drive}${separator}${joined}` : `${drive}${separator}`
  }
  if (isAbsolute) {
    return `${separator}${joined}`
  }
  return joined || '.'
}

export function joinPaths(base: string, ...parts: string[]) {
  const separator = usesBackslashSeparator(base, ...parts) ? '\\' : '/'
  const segments = [base, ...parts].flatMap((part) => toSlashSegments(part).segments)
  const { drive, isAbsolute } = toSlashSegments(base)
  const joined = segments.join(separator)

  if (drive) {
    return joined ? `${drive}${separator}${joined}` : `${drive}${separator}`
  }
  if (isAbsolute) {
    return `${separator}${joined}`
  }
  return joined || '.'
}
