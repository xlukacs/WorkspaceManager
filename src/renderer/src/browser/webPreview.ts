/** True only in the `pnpm web` preview build (vite.web.config.ts), never in Electron. */
export const IS_WEB_PREVIEW = import.meta.env.VITE_WORKSPACE_MANAGER_WEB_PREVIEW === 'true'

/**
 * Install the in-memory demo API for the browser preview. Electron must not get it: a missing
 * preload has to surface as "bridge unavailable" instead of showing demo data.
 */
export async function prepareWorkspaceApi(webPreview = IS_WEB_PREVIEW) {
  if (!webPreview) return
  const { ensureWorkspaceApi } = await import('@renderer/browser/mockWorkspaceApi')
  ensureWorkspaceApi()
}
