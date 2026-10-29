const DOM_RENDERER_LEAK_PATTERN = /\.xterm-dom-renderer-owner-\d+/i
export const TERMINAL_BUFFER_LIMIT = 160_000

export type TerminalBufferSync =
  | { mode: 'noop' }
  | { mode: 'append'; chunk: string }
  | { mode: 'replace'; chunk: string }

export function containsDomRendererLeak(text: string) {
  return DOM_RENDERER_LEAK_PATTERN.test(text)
}

export function appendTerminalBuffer(buffer: string, chunk: string) {
  if (containsDomRendererLeak(chunk)) return buffer
  const next = `${buffer}${chunk}`
  return next.length > TERMINAL_BUFFER_LIMIT ? next.slice(next.length - TERMINAL_BUFFER_LIMIT) : next
}

export function sanitizeTerminalBuffer(buffer: string) {
  if (!containsDomRendererLeak(buffer)) return buffer
  return buffer
    .split('\n')
    .filter((line) => !containsDomRendererLeak(line) && !line.includes('.xterm-rows span'))
    .join('\n')
    .trim()
}

export function diffTerminalBuffer(previous: string, next: string): TerminalBufferSync {
  if (next === previous) return { mode: 'noop' }
  if (next.startsWith(previous)) {
    return previous.length === next.length ? { mode: 'noop' } : { mode: 'append', chunk: next.slice(previous.length) }
  }

  if (next.length === TERMINAL_BUFFER_LIMIT) {
    const overlap = suffixPrefixOverlap(previous, next)
    if (overlap > 0) {
      const chunk = next.slice(overlap)
      return chunk ? { mode: 'append', chunk } : { mode: 'noop' }
    }
  }

  return { mode: 'replace', chunk: next }
}

function suffixPrefixOverlap(left: string, right: string) {
  if (left.length === 0 || right.length === 0) return 0

  const lps = computeLps(right)
  let match = 0
  const start = Math.max(0, left.length - right.length)

  for (let index = start; index < left.length; index += 1) {
    while (match > 0 && left[index] !== right[match]) {
      match = lps[match - 1]
    }
    if (left[index] === right[match]) {
      match += 1
      if (match === right.length && index < left.length - 1) {
        match = lps[match - 1]
      }
    }
  }

  return match
}

function computeLps(pattern: string) {
  const lps = new Array<number>(pattern.length).fill(0)
  let length = 0

  for (let index = 1; index < pattern.length; index += 1) {
    while (length > 0 && pattern[index] !== pattern[length]) {
      length = lps[length - 1]
    }
    if (pattern[index] === pattern[length]) {
      length += 1
      lps[index] = length
    }
  }

  return lps
}
