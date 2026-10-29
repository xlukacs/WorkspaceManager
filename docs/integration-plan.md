# Integration plan: merging the transferred app's model into Workspace Manager

Status: **All phase PRs (0–5) and acceptance fixes F1–F3 are merged. Windows and Linux package verification passed on 2026-10-26.** Originally written 2026-10-22. Completion audit ran against `e681d4e50a18cc6aaed878df58c7bc5d4993a3bb`; fixes merged into `main` at `d68b6ebb3530aa88dde08d3bfb38321fe0059d29`. Package evidence is recorded below.

## Current implementation status

- **Phases 0 / 1A / 1B merged:** [#5](https://github.com/xlukacs/WorkspaceManager/pull/5), [#6](https://github.com/xlukacs/WorkspaceManager/pull/6), [#7](https://github.com/xlukacs/WorkspaceManager/pull/7): headless CLI/MCP, Python and execution fixes, PTY resize, preview gating and TypeScript cleanup.
- **Phase 2A merged:** [#9](https://github.com/xlukacs/WorkspaceManager/pull/9), [#10](https://github.com/xlukacs/WorkspaceManager/pull/10), [#11](https://github.com/xlukacs/WorkspaceManager/pull/11), [#8](https://github.com/xlukacs/WorkspaceManager/pull/8): vocabulary/API/renderer/mock renaming with storage and public API compatibility.
- **Phase 2B merged:** [#12](https://github.com/xlukacs/WorkspaceManager/pull/12), [#13](https://github.com/xlukacs/WorkspaceManager/pull/13), [#14](https://github.com/xlukacs/WorkspaceManager/pull/14): mixed-language discovery, backed-up/idempotent migration, and the unified command index/planner. F2 was completed in #23.
- **Phase 2C merged:** [#15](https://github.com/xlukacs/WorkspaceManager/pull/15), [#16](https://github.com/xlukacs/WorkspaceManager/pull/16), [#17](https://github.com/xlukacs/WorkspaceManager/pull/17): canonical API, group/workspace sidebar, project-grouped commands and shared prerequisite picker.
- **Phase 3 merged:** [#18](https://github.com/xlukacs/WorkspaceManager/pull/18), [#19](https://github.com/xlukacs/WorkspaceManager/pull/19): group controls, per-session resume warnings, saved navigation, worktree filtering and shortcuts. The earlier resume-aborts-on-first-failure gap is fixed. F1 was completed in #23.
- **Phase 4 merged:** [#20](https://github.com/xlukacs/WorkspaceManager/pull/20), [#21](https://github.com/xlukacs/WorkspaceManager/pull/21): authenticated local app protocol, GUI-connected CLI/MCP actions, single-instance routing and Windows wrappers. F3 was completed in #23.
- **Phase 5 merged:** [#22](https://github.com/xlukacs/WorkspaceManager/pull/22): saved preferences, GUI/headless certificate propagation, selected-checkout Open behavior, external terminal fallback, error recovery and window reattachment. Store schema is now **v14**; v12/v13 migration stages below describe the historical sequence.
- **Acceptance fixes merged:** [#23](https://github.com/xlukacs/WorkspaceManager/pull/23) implements F1–F3 (`2aa92ad`, merge `d68b6eb`). All 264 tests, typecheck, desktop/CLI build and web build pass.
- **Package verification passed:** [#24](https://github.com/xlukacs/WorkspaceManager/pull/24) fixes bundled Electron CLI argument handling and adds native package jobs. Both jobs passed in [workflow run 40322874475](https://github.com/xlukacs/WorkspaceManager/actions/runs/40322874475), for PR head `5c807f2` (tested merge revision `05d359a49578fd4e67257e715fdc833fb7e5a0d5`). Matching Windows setup/portable executables and Linux desktop/CLI packages are retained as run artifacts.

**Verification:** pre-follow-up main passed **43 test files / 251 tests**; #23 passed **43 test files / 264 tests**. #24 passed **44 test files / 266 tests**, typecheck, desktop/CLI build and web build, plus the native Windows and Linux package jobs linked above. Existing renderer tests print React `act(...)` warnings; they still pass. Windows evidence now includes executing the real installer and installed desktop/CLI, beyond the earlier Linux-host NSIS macro compilation.

**Handoff:** start any new work from fetched `origin/main`. All identified acceptance gaps are fixed; do not replay the completed phase branches. This checked-in plan retains the original scope and historical observations as the acceptance reference.

## Acceptance follow-ups from the completion audit

These were confirmed differences from the written plan. All three are resolved by merged [PR #23](https://github.com/xlukacs/WorkspaceManager/pull/23); do not start duplicate work. The observations below describe the pre-fix audit. Regression cases failed before the fixes. The PR preserves Stop/Stop All history, adds nested install helpers and preview parity, and verifies canonical store identity in endpoint discovery and every server request. Update the CLI and restart the desktop together for the new store-bound protocol. The tests in #23 are the durable acceptance evidence; the original local audit files may no longer be available.

1. **F1 — Group Kill retains consoles and pins (Phase 3).** The plan requires group kill to stop and remove matching consoles and their pin/pause records. [The merged manager](https://github.com/xlukacs/WorkspaceManager/blob/e681d4e50a18cc6aaed878df58c7bc5d4993a3bb/src/main/services/terminalManager.ts#L467) only stops running/paused sessions and clears pause flags; ended sessions, console history and pins remain. A focused manager probe confirmed a killed pinned console remains in `list()`, stopped and pinned. Follow up with group-scoped removal and renderer/store synchronization, preserving app-wide stop-all's history-retaining behavior; test stopped/ended and pinned members plus isolation from other groups. Retaining history instead would be a change to the written acceptance criteria, not a completed implementation of them.
2. **F2 — Nested Node install helpers are absent (Phase 2B).** The plan defines non-root synthetic Node installer IDs and commands for detected projects. [The merged command index](https://github.com/xlukacs/WorkspaceManager/blob/e681d4e50a18cc6aaed878df58c7bc5d4993a3bb/src/main/services/workspaceCommands.ts#L84) creates a Node installer only when `root` is true. A scanned `apps/web/package.json` project has its scripts but no synthetic installer. Add the promised non-root helper using the documented namespaced ID, with the detected project's package manager and checkout-relative cwd; test uniqueness when an `install` script exists, and preserve existing root/declared script IDs. The requirements filename is currently resolved from the main checkout at plan time rather than stored in `requirementsFile`; that representation difference alone is not being counted as a missing feature.
3. **F3 — App endpoint does not verify the selected store file (Phase 4).** [Client discovery](https://github.com/xlukacs/WorkspaceManager/blob/e681d4e50a18cc6aaed878df58c7bc5d4993a3bb/src/agent/appClient.ts#L12) looks for `cli.json` beside `--store`, but the endpoint/handshake carries no store identity. A probe requesting `different.json` in the running app store's directory was accepted by that app. Add the canonical store path to endpoint metadata and verify it in the server handshake/request before mutations; reject a filename mismatch even within one directory. Test normal selection, same-directory different files, stale endpoints and unchanged headless behavior. Use the existing path comparison policy; case-sensitivity cleanup remains deferred.

**Release verification passed:** the linked **Verify packages** run built matching Windows setup/portable executables and Linux desktop/CLI packages. Windows passed silent install, user PATH and both CLI aliases, the installed renderer and native PTY, pause/resume/stop, store identity, reinstall and uninstall cleanup. Linux passed the tests and installation, desktop/PTY exercise and removal of both packages. The portable Windows executable was built; runtime checks exercised the NSIS-installed app. Artifacts become available only after each platform's verification passes; use both platforms from the same successful run for a release and restart the upgraded desktop. Signing, publishing and a human visual walkthrough are not performed by this workflow. None of the intentionally deferred items at the end of this plan has been added to the scope.

Background analysis described an earlier snapshot; this plan's audited status above supersedes its outstanding-bug and CLI-gap lists.
"Transferred app" means the earlier desktop snapshot used as a feature reference only. Do not copy its `App.tsx` or its config store.

## Decisions already made

These are settled. Do not revisit them without asking the owner.

1. **Hierarchy:** adopt the transferred app's **Group → Workspace → (Worktree → Consoles)** model.
   - A *workspace* is a registered folder, usually a repository root. It is today's `ProjectRecord`.
   - A workspace contains *detected projects*: Node, Python and Docker folders found inside it. Today's `WorkspacePackage` is one kind of detected project.
   - Each workspace belongs to at most one *group*. Groups replace collections.
   - Consoles belong to a workspace and are started in one of its worktrees.
2. **PR #5:** the inherited planner bugs were fixed inside PR #5 before it merged. Preserve those fixes and their regression tests during the remaining refactors.
3. **Public naming:** in the CLI and MCP, "workspace" means the registered folder, matching decision 1. PR #5's `list_workspaces`, `get_workspace`, `list_commands` and `run_command` therefore keep their names. *(The owner first chose "rename PR #5's tools to project". That choice rested on an analysis error. See [Note on naming](#note-on-naming).)*
4. **Console tabs:** show consoles from all worktrees by default, with a toggle that limits the list to the selected worktree. Persist the toggle.
5. **Base:** keep this app's terminal engine (node-pty + xterm), worktree lifecycle, Docker actions, Run actions, quick links, endpoints, tests and component/store layout. Bring features *into* it; do not port the transferred UI wholesale.

## Ground rules for every phase

- One PR per phase (or sub-phase), targeting `main` unless the phase says otherwise. Keep PRs reviewable; split further if a diff grows past roughly 1,500 changed lines of non-test code.
- Every remaining PR must pass `pnpm test`, `pnpm build` (desktop + CLI), and `pnpm typecheck` (already added by #7). For renderer/preload/mock changes, also run `pnpm exec vite build --config vite.web.config.ts`.
- Preserve #5's headless CLI/MCP transports, timeout/dry-run/JSON behavior, shell environment setup, Debian layout tests, and HTTP origin/content-type/token checks. Shared discovery/planning services must not import Electron, `electron-store`, or the PTY runtime into `out/cli`.
- Every bug fix gets a regression test that fails before the fix.
- Store schema changes go through `AppStore.migrate()` in `src/main/store.ts`, with a version bump and a migration test.
- Keep the browser mock (`src/renderer/src/browser/mockWorkspaceApi.ts`) compiling and roughly in sync with API changes, so `pnpm web` keeps working.
- Do not change command ID formats except where this plan says so. Stored favorites, chains and PR #5 users depend on them.

---

## Completed phases — do not repeat

### Phase 0 — Completed by PR #5

Delivered the agent CLI/MCP and planner fixes:

- Python install steps and existing venv metadata use the selected checkout.
- Python install as a prerequisite retains its create-venv and pip steps.
- Run actions remap the Python environment, and command listings report worktree-aware cwd.
- Regression tests cover the planner paths and the CLI Python worktree dry-run; unauthenticated HTTP startup prints the requested notice.

### Phase 1A — Completed by PR #6

Delivered all four baseline fixes:

- Dockerfile/Compose-only folders are accepted as import candidates.
- `src/shared/worktreeExecution.ts` separates strict execution resolution (`resolveWorktreePath`) from tolerant UI selection (`resolveSelectedWorktreePath`). `src/main/services/runWorktree.ts` adds the requested checkout's on-disk existence check and is shared with the agent catalog.
- `terminals.resize` is wired through the manager, IPC, preload, renderer and mock. Initial sizing and resize changes are tested.
- `src/renderer/src/browser/webPreview.ts` gates the mock to the explicit preview build; Electron does not silently use demo data.

Keep execution strict and selection recovery tolerant in every subsequent phase. A stale UI selection may recover to a default; an explicit request to run in an unavailable checkout must fail.

### Phase 1B — Completed by PR #7

Delivered `pnpm typecheck`, bundler-compatible module resolution, corrected window/store typing, renderer event/Zustand typing, launcher argument types, and updated fixtures. Both configurations now pass. Do not reintroduce the removed Zustand equality argument or stale-buffer caching while restructuring console tabs.

---

## Phase 2 — Workspace model (merged; F2 fixed in #23)

Implementation landed as the Phase 2A, 2B and 2C PR stacks listed above. The sections below retain the intended acceptance criteria.

### 2A. Mechanical rename (no behavior change) — merged in #9, #10, #11, #8

Rename code to the new vocabulary so later diffs are readable. Behavior and stored data stay byte-identical.

| Today | After |
|---|---|
| `ProjectRecord` | `WorkspaceRecord` |
| `WorkspacePackage` | `DetectedProject` |
| `CollectionRecord` | `GroupRecord` (fields unchanged for now) |
| `projectId` (when it means the record) | `workspaceId` |
| IPC `projects.*`, `collections.*` | `workspaces.*`, `groups.*` |
| `ProjectPanel`, `useAppStore` project slices | `WorkspacePanel`, workspace slices |
| User-facing text "project", "collection" | "workspace", "group" |

- Persisted JSON keys (`projects`, `collections`, `collectionIds`) stay unchanged in this PR. The store layer maps them. Phase 2B migrates the data.
- `CommandDescriptor.scope: 'workspace'` and `workspaceId`/`workspaceName` (meaning a monorepo package today) become `scope: 'project'` and `projectId`/`projectName`.
- Update the merged `src/agent/*` to the new internal type names. Its CLI/MCP input and output fields must not change in 2A. In particular, the existing `project` MCP argument, `--project` and `--collection` CLI options, `AgentCommand.projectId` and the `run` result's `project` object are public compatibility fields; a TypeScript rename does not authorize renaming them.
- Keep persistent-data DTOs separate from renamed runtime types, including terminal `projectId`, so the rename itself does not rewrite v11 JSON.

**Done when:** tests, build and typecheck pass; a store file saved by the previous version loads unchanged and round-trips identically; desktop UI labels use "group"; legacy CLI/MCP compatibility fields and flags may still say "collection".

### 2B. Data model, discovery and migration — merged in #12–#14; F2 fixed in #23

#### Target types (in `src/shared/types.ts`)

```ts
interface GroupRecord {
  id: string
  name: string
  order: number
  color: string | null
}

interface WorkspaceRecord {
  id: string               // unchanged from the old ProjectRecord.id
  name: string
  nameOverride: string | null
  order: number            // order within its group
  rootPath: string
  groupId: string | null   // null = ungrouped
  openTarget: OpenTarget | null   // per-workspace override, phase 5
  projects: DetectedProject[]
  // existing fields carried over unchanged:
  commandChains, favoriteCommandIds, runActions, defaultRunActionId,
  pinnedEndpoints, quickLinks, gitSummary, gitWorktrees, gitWorktreesRoot, lastScanAt
}

type ProjectCapability = 'node' | 'python' | 'docker'

interface DetectedProject {
  id: string               // 'root' for the workspace root; otherwise createId(absPath), as today
  name: string
  relativePath: string     // '' for root; always relative to the workspace root
  capabilities: ProjectCapability[]
  source: 'root' | 'declared' | 'scanned'  // declared = matched a package.json/pnpm workspace glob
  packageManager: PackageManager | null   // node only
  scripts: Record<string, string>         // node only
  docker: DockerConfig | null
  python: {
    venvRelativePath: string | null
    installSource: 'requirements' | 'pyproject' | null
    requirementsFile: string | null // project-relative filename, e.g. requirements-dev.txt
  } | null
}
```

- Python environments are stored **relative** to the project. Executable paths are resolved at plan time against the chosen worktree. Preserve #5's worktree/Python fixes and tests. An installer must check whether that checkout's venv exists and include creation if needed; ordinary commands that require a missing selected venv fail clearly, rather than borrowing the main checkout's interpreter. Resolving environment/filesystem availability is not per-worktree manifest rescanning.
- `rootScripts`, `workspacePackages`, top-level `docker` and top-level `pythonEnvironment` are removed. Their data lives in `projects` (the root project carries the old root fields).
- `isMonorepo` and the top-level `packageManager` become derived getters or helpers, not stored fields.

#### Discovery rules (`src/main/services/projectDiscovery.ts`)

1. Root project: always present (`id: 'root'`), with whatever capabilities the root has.
2. Declared Node packages: the existing `package.json` `workspaces` / `pnpm-workspace.yaml` logic, unchanged, `source: 'declared'`.
3. Recursive scan to depth 4 for Python markers, Docker markers (Dockerfile and compose variants) and `package.json`, with `source: 'scanned'`. Reuse the existing Python marker/environment detection instead of narrowing it to three filenames: preserve root support for `requirements-dev.txt`, `Pipfile`, `setup.cfg`, environment YAML and the existing venv discovery behavior, as well as `requirements.txt`, `pyproject.toml`, and `setup.py`. Preserve the chosen requirements filename (`requirements.txt`, `requirements-dev.txt` or `requirements.in`) in command planning.

   - **Node in a declared monorepo:** if the root declares workspaces, `package.json` files that are *not* declared are ignored. This avoids picking up fixtures and examples.
   - **Node without declarations:** if the root declares none, every `package.json` found becomes a Node project.
   - **Merging:** a folder that is both declared and scanned is one project; capabilities are merged.
4. Ignore during recursion: `node_modules`, `.git`, `.venv`, `venv`, `env`, `__pycache__`, `dist`, `build`, `out`, `.next`, `.turbo`, `.cache`, `coverage`, `.worktrees`, the workspace's `gitWorktreesRoot`, and the path of any linked worktree of this repo. Nested worktrees must never become projects.
5. Limit concurrent directory reads (for example 16 at a time).
6. Package manager for scanned Node projects: the nearest `packageManager` field or lockfile, walking up to the workspace root; otherwise npm. Yarn stays supported.

#### Command IDs

Keep existing IDs **byte-identical** so stored favorites, chains and PR #5 users keep working:

- Root scripts: `${workspaceId}::root::${name}` (unchanged)
- Declared package scripts: `${workspaceId}::${project.id}::${name}` (unchanged, since `project.id = createId(absPath)` as today)
- Scanned projects: the same pattern as declared packages
- Root synthetic: `${workspaceId}::synthetic::node-install` and `::synthetic::python-install` (unchanged)
- Synthetic for non-root projects: `${workspaceId}::${project.id}::synthetic::node-install` and `${workspaceId}::${project.id}::synthetic::python-install` (new). Update helper recognition consistently; today's Python recognizer is named `isSyntheticPythonInstall`.
- Docker: `${workspaceId}::docker::${key}` stays for the root. Non-root becomes `${workspaceId}::${project.id}::docker::${key}`. Update the `includes('::docker::compose-')` filters accordingly.
- Run actions: unchanged.

#### One command index and one planner

Promote PR #5's `listProjectCommands` and `resolveRunnable` dispatch (`src/agent/catalog.ts`) into a main/shared service, for example `src/main/services/workspaceCommands.ts`, with:

- `listWorkspaceCommands(workspace)`: scripts, synthetic installers, Docker actions and Run actions for every detected project, grouped by project.
- `resolveRunPlan(workspace, commandId, worktreePath | null)`: one entry point that expands prerequisites recursively across **all** command kinds, so a chain can mix Docker, Python and Node steps. It deduplicates, rejects cycles (as today) and expands compound helpers fully (phase 0 fix).

The GUI command and Docker panels, and the merged CLI/MCP, all use this service. Keep `catalog.ts` as a compatibility/presentation adapter where needed; remove its duplicate planning dispatch, not its established public interface. Run the existing agent/catalog, CLI, HTTP MCP and Debian layout tests after this change. Preserve lookup by full ID, unique script/title, and package-name aliases; reject ambiguous lookups as before.

**Public compatibility during the model migration:** keep the four shipped MCP tool names and existing input fields/options working. Add group/project detail fields as needed; retain legacy JSON fields (including `collections`, `workspacePackages`, root script/Docker/Python details, derived summary fields, command `projectId`, and the `run` result's `project`) as compatibility projections of the new model in this integration. `collections` represents zero or one selected group after migration; legacy command `projectId` continues to identify the enclosing workspace, with a separate field for detected-project identity if exposed. Keep the legacy package list limited to Node packages. The existing `--collection` / MCP `collection` filter maps to the workspace's group. Test old CLI invocations and MCP payloads against a migrated store. A future removal of compatibility fields requires a separate versioned API change.

Worktree execution: commands come from the main checkout's scan and run in the chosen worktree, with each project's `relativePath` resolved inside it. Reuse #6's strict execution resolver in GUI, CLI, MCP, restart and resume paths. Validate that the checkout and each step's project folder exist as directories; fail clearly instead of running elsewhere. Keep tolerant selection restoration separate. Per-worktree manifest rescanning is out of scope (see the end of this plan).

#### Store migration (v11 → v12)

1. **Back up first.** Before writing, copy the existing store file to `workspace-manager.v11.backup.json` next to it. Skip if the backup already exists.
2. **Collections become groups.** Each collection becomes a group (same id, name and order), with `color: null`.
3. **Single group per workspace.** For each project, `groupId` is the group of its **first membership in sidebar collection order**; with no memberships, `groupId` is null.
   - Record dropped memberships in a `migrationNotes: string[]` field on the stored state, for example `"API was also in 'Backend'; kept 'Frontend'"`.
   - The renderer shows these notes once in a dismissible banner, then clears them.
4. **Projects become workspaces.** Build `projects` from the old `rootScripts`, `workspacePackages`, `docker` and `pythonEnvironment`, converting absolute venv paths to relative. Then queue a background rescan of every workspace after startup, so scanned projects appear without blocking launch.
5. **Terminals.** Rename `projectId` to `workspaceId` and add `projectId: string | null` (the detected project; null for old sessions).
6. **Agent store reader.** `src/agent/loadStore.ts` must read both v11 and v12 files, because the CLI may run against a store the app has not migrated yet. Share a pure decoder/normalizer with the app where practical; headless reads must not write/migrate the file or initialize Electron. Preserve settings and compatible CLI/MCP output when decoding either version. Add a test for each. Build and distribute the updated CLI alongside the schema-changing desktop release; the old already-installed CLI cannot be assumed to understand v12.
7. **Migration replay:** a second load of v12 must not rerun v11 conversion, duplicate projects, overwrite the existing backup, or repeat dismissed migration notes. Preserve IDs and stopped/pinned/paused session data, including original worktree paths.

**Done when:**
- Migration tests cover: no collections; one collection; multiple memberships; Python env path conversion; terminal rewrite; backup creation.
- Discovery tests cover the mixed folder below, a declared monorepo with an undeclared fixture `package.json` (ignored), and a nested `.worktrees/x/package.json` (ignored).
- Existing command IDs in a fixture store still resolve after migration, including synthetic commands, Docker actions and Run actions. All emitted IDs are unique, including when a package declares an `install` script.
- Agent tests confirm v11/v12 read compatibility, unchanged legacy arguments/fields, ambiguous command handling, and Electron-free CLI startup. The migrated store loads twice without duplicating data or repeating notes.

  ```text
  product/
    package.json
    apps/web/package.json            (declared)
    services/api/requirements.txt    (scanned, python)
    infrastructure/compose.yaml      (scanned, docker)
  ```

### 2C. Workspace UI — merged in #15–#17

1. **Sidebar tree:** Group → Workspace, with an "Ungrouped" section last.
   - Groups: create, rename, delete (workspaces become ungrouped), reorder, set color, collapse.
   - Workspaces: drag between groups and within a group; context menu "Move to group…".
2. **Import drawer:** choose one target group (or none) instead of collections.
3. **Workspace panel:** commands grouped by detected project. Each project header shows its relative path and capability badges. Search covers all projects. The chain editor can pick prerequisites from any project and any kind.
4. **Rescan:** keep the existing explicit rescan action, and run one background rescan per workspace at startup (non-blocking; reuse the 2B queue).

**Done when:** a workspace with Node, Python and Docker subprojects shows all three in the panel. A cross-kind chain can be created and dry-run; use `services/api python:install → infrastructure compose build → apps/web dev` for an executable example. A foreground `compose up` prerequisite would block following steps until it exits; service readiness remains out of scope. Renderer tests cover the group tree operations.

---

## Phase 3 — Group actions, consoles and persistent navigation (merged; F1 fixed in #23)

1. **Group process actions** in `terminalManager.ts`, through IPC, preload and the mock:
   - `pauseGroup`, `resumeGroup` and `killGroup`, built on the existing `pauseProject`/`resumeProject` (rename them `pauseWorkspace`/`resumeWorkspace`).
   - Resume returns per-session warnings (as the transferred app's `ResumeWorkspaceResult` does), and the UI shows them. This is the explicit follow-up documented in PR #6: catch an invalid session/worktree, leave that session paused for retry, continue with later sessions and other workspaces, and report each failure without silently running a fallback plan.
   - Define actions consistently: stop retains the console and output; pause additionally marks it for resume; group kill stops and removes matching consoles and their pin/pause records, as in the transferred app. The existing app-wide stop-all retains records.
2. **Stop all** stays (`stopAll`), including the existing UI label if retained; it stops processes and keeps console records. Do not reuse the group-kill removal semantics for it.
3. **Console tab filter** (decision 4): a toggle in the terminal dock header, "All worktrees" / "This worktree", persisted. Tab labels show the worktree branch when the filter is "All".
4. **Persist navigation in the store** under a `ui` key, not localStorage:
   - selected group and workspace
   - selected worktree per workspace
   - sidebar collapsed and collapsed groups
   - the tab filter

   Restore on launch. Invalid references (deleted workspace, missing worktree) fall back silently to defaults.
5. **Keyboard:** add the transferred shortcuts this app lacks: restart active console, open in explorer, Ctrl+1–9 select workspace, Alt+1–9 select console. Keep existing bindings. Add a read-only shortcuts reference to the settings page (phase 5).

**Done when:** pausing a group stops every running console in its workspaces, and resuming restarts them with warnings for failures. A test puts an invalid/deleted worktree first and confirms later valid sessions still resume, the failed one stays paused, and no command runs in another checkout. Group kill removes only its members' sessions; stop-all retains them. Relaunching restores selection and the filter. Preserve the merged rename, copy/search, output batching and resize behavior while filtering tabs.

---

## Phase 4 — In-app CLI mode (merged in #20–#21; F3 fixed in #23)

PR #5's `wsm` runs commands headlessly and synchronously. This phase adds verbs that act on the **running app**, as the transferred `wm` does. Both live in the same binary; there must be no second CLI.

1. **Single instance:** call `app.requestSingleInstanceLock()` in `src/main/index.ts`. A second launch focuses the existing window.
2. **Local endpoint**, modeled on the transferred `src/main/cli-server.ts`:
   - On startup the app listens on `127.0.0.1:0` and writes `{ port, token }` to `cli.json` in the app's userData directory, with file mode 0600 on Unix. Remove the file on quit.
   - Requests are newline-delimited JSON with the token, capped at 64 KiB, with a 60 s timeout.
   - Serialize request handling, as the transferred `runCliExclusive` does.
   - This app-control endpoint is separate from #5's HTTP MCP listener (default port 3847); do not repurpose or remove the existing headless server. Resolve `cli.json` from the selected/default store directory, including `--store` / `WORKSPACE_MANAGER_STORE`, and verify the endpoint serves that store so a client cannot control a different workspace catalog by accident. A stale/unreachable endpoint produces the stated app-not-running error.
   - Execute registration, session control and store mutations inside the app through its existing services, with events updating the UI. The CLI must not independently write the store or start a second terminal engine.

3. **New verbs.** These require the app; if it is not running, fail with "Workspace Manager is not running".

   | Verb | Behavior |
   |---|---|
   | `wsm add <path> [--group <name>] [--name <n>]` | Register a workspace; create the group if missing |
   | `wsm start <workspace> <command> [--worktree <b>]` | Run a **stored** command in a GUI console; print the session id |
   | `wsm start --cwd <dir> [--label <l>] -- <cmd…>` | Run arbitrary text in a GUI console; the workspace is inferred from `--cwd`, registered if needed |
   | `wsm sessions [--workspace <w>] [--group <g>] [--running] [--json]` | List consoles |
   | `wsm stop <session-id>` / `wsm stop --workspace <w>` / `wsm stop --group <g>` | Stop consoles |
   | `wsm pause` / `wsm resume --workspace <w>` or `--group <g>` | Group and workspace pause/resume |
   | `wsm kill-all` | Stop every console |
   | `wsm focus [<workspace>] [--session <id>]` | Bring the window forward and select it |
   | `wsm worktrees <workspace> [--json]` | List worktrees (can work without the app, from the store) |

   Keep PR #5's `run` as headless and synchronous. Document the difference in `wsm help`: `run` waits and returns an exit code; `start` hands off to the app.
4. **MCP:** when the app endpoint is reachable, also expose `list_sessions`, `start_command`, `stop_session` and `get_session_output` (last N KB of the session buffer). When it is not reachable, omit these tools from each new `tools/list` response. Keep the existing `run_command` headless and synchronous. Implement the additions in the shared handler used by both stdio and HTTP, and handle loss of the app between discovery and a call with a clear app-not-running result. The current stateless HTTP transport advertises no server-initiated tool-list notifications; do not assume connected clients automatically refresh discovery. Keep #5's token/origin/content-type controls and existing stdio/HTTP tests intact. A Docker MCP instance without access to the host app endpoint simply retains the headless tools.
5. **Distribution:**
   - Windows: add `build/installer.nsh` PATH wrappers (`wsm.cmd`, `workspace-manager.cmd`) modeled on the transferred `build/installer.nsh`, with uninstall cleanup.
   - Linux: #5 ships a **separate** `workspace-manager-cli` `.deb`; `build:linux` emits it alongside the desktop `.deb`. Preserve that two-package layout and the systemd/Docker headless entry points. Verify `wsm start` against the running packaged desktop with the CLI package installed.

**Done when:** with the app running, `wsm start <ws> dev` opens a GUI console, `wsm sessions --json` lists it, `wsm stop <id>` stops it, and MCP `start_command` does the same over stdio and HTTP. With the app closed, those verbs fail with the message above, app-only tools are omitted on a fresh discovery, and headless list/show/commands/run plus the four existing MCP tools still work. Tests cover bad tokens, oversize requests, stale/mismatched endpoints, CLI parsing and app loss after discovery. A no-app `wsm run ... --dry-run --json` smoke test must still work without importing Electron.

---

## Phase 5 — Settings (merged in #22)

Add a Settings page (new route or dialog) backed by the store's `settings`:

1. **Node CA certificate:** file picker. When set, `src/shared/shellEnv.ts` adds `NODE_EXTRA_CA_CERTS` to every console and CLI/MCP run. Wire the setting through both `AppStore` and `src/agent/loadStore.ts` / `catalogFromState`; the current agent loader only carries shell/window settings and would otherwise drop the new value. Pass overrides into the shared env builder explicitly rather than relying on the separate CLI/server process to inherit the app's environment. Clearing the app override restores inherited-environment behavior.
2. **Preferred external terminal:** per-OS choices. Windows: Windows Terminal, PowerShell, Command Prompt. Linux and macOS: keep today's automatic detection, with an optional explicit choice. `systemActions.ts` uses the preference and falls back to automatic.
3. **Default Open target:** global (Cursor, VS Code, folder, terminal) plus a per-workspace override (`WorkspaceRecord.openTarget`). It always opens the **selected worktree**, which is today's behavior; keep it.
4. **Preferred shell:** surface the existing `settings.preferredShell`. Apply changed settings to subsequent launches/restarts in the app and to fresh headless catalog reads; do not silently restart running consoles. `TerminalManager` currently captures the shell in its constructor, so add a settings getter/update path rather than just persisting a field.
5. **Shortcuts reference:** read-only list (from phase 3).
6. **Error boundary:** extend the React boundary to also catch `window` `error` and `unhandledrejection`, with Retry and Reload buttons (transferred `App.tsx` precedent).

**Done when:** each setting persists across relaunch and affects behavior. Tests confirm GUI, headless CLI and MCP apply the same saved CA override; clearing it works; shell changes affect subsequent launches/restarts; and the agent store reader retains all added settings. Recheck the selected-worktree Open behavior and explicit preview gate after the new settings route is added.

---

## Out of scope (do not implement without asking)

- **Delineation / Merger CLI** integration from the transferred app.
- **Service readiness:** health checks or "wait for port" between chain steps. Chains still wait for each step to exit.
- **Per-worktree rescanning:** commands are always discovered from the main checkout.
- Importing the transferred app's config file. Users re-add workspaces; there is no config migration from the other app.
- Case-sensitivity cleanup of path comparison helpers. It is noted as a known limit, not part of this work.

## Phase order and dependencies

```text
All phase PRs merged: 0 → 1A/1B → 2A → 2B → 2C → 3 → 4 → 5
Merged: #23 implements F1 (group kill), F2 (nested install), F3 (store-bound endpoint)
Package verification passed: native Windows and Linux jobs in run 40322874475
```

All phase dependencies have landed. Start follow-up branches from current `origin/main`; do not reopen or replay merged phase branches. F1–F3 are complete. The deliberate out-of-scope items above are unchanged.

## Note on naming

The earlier comparison suggested renaming PR #5's tools from "workspace" to "project", on the grounds that adopting the transferred model would give "workspace" a different meaning. That was wrong. The transferred `WorkspaceRecord` (a registered folder containing detected projects) corresponds to today's `ProjectRecord` (an imported folder containing packages). PR #5's "workspace" naming already matches the target model, so renaming it to "project" now would mean renaming it back in phase 2A. The internal collision is with today's `WorkspacePackage`; phase 2A resolves it by renaming that to `DetectedProject`.
