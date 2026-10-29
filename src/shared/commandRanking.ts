export function rankScriptName(name: string) {
  const normalized = name.toLowerCase()
  if (normalized === 'dev') return 100
  if (normalized === 'start') return 90
  if (normalized.endsWith(':dev')) return 85
  if (normalized.includes('dev')) return 82
  if (normalized.includes('serve')) return 78
  if (normalized.includes('watch')) return 76
  if (normalized.includes('build')) return 48
  if (normalized.includes('test')) return 42
  return 20
}
