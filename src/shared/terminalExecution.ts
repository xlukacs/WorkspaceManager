import type { CommandRunPlan } from '@shared/types'

const LONG_RUNNING_SHELL_PATTERN = /(?:^|[\s:])dev(?:$|[\s:])|start|serve|watch|logs|\bup\b/i

export function isLongRunningRunPlan(runPlan: CommandRunPlan) {
  const execution = runPlan.steps.at(-1)
  if (!execution) return false
  return LONG_RUNNING_SHELL_PATTERN.test(execution.shellLine)
}
