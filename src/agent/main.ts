import { runCli } from '@agent/cli'

// process.exit() drops writes still queued for a pipe, which cut `--json`
// output off at 64 KiB. Exit only once stdout and stderr have flushed.
function exitAfterFlush(code: number) {
  let pending = 2
  const done = () => {
    pending -= 1
    if (pending === 0) process.exit(code)
  }
  process.stdout.write('', done)
  process.stderr.write('', done)
}

try {
  // Node and ELECTRON_RUN_AS_NODE both put the executable and script first.
  // Strip them here so a packaged WorkspaceManager.exe is not a CLI command.
  exitAfterFlush(await runCli(process.argv.slice(2)))
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  exitAfterFlush(1)
}
