export function createRafBatch<T>(flush: (items: T[]) => void) {
  let items: T[] = []
  let frame = 0

  const run = () => {
    frame = 0
    const batch = items
    items = []
    if (batch.length > 0) flush(batch)
  }

  const push = (item: T) => {
    items.push(item)
    if (frame !== 0) return
    frame = requestAnimationFrame(run)
  }

  push.flush = () => {
    if (frame !== 0) cancelAnimationFrame(frame)
    run()
  }

  push.cancel = () => {
    if (frame !== 0) cancelAnimationFrame(frame)
    frame = 0
    items = []
  }

  return push
}

export function createDebounced(fn: () => void, waitMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined

  const run = () => {
    timer = undefined
    fn()
  }

  const debounced = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(run, waitMs)
  }

  debounced.flush = () => {
    if (timer === undefined) return
    clearTimeout(timer)
    run()
  }

  debounced.cancel = () => {
    if (timer === undefined) return
    clearTimeout(timer)
    timer = undefined
  }

  return debounced
}
