/// <reference types="vite/client" />

declare module '*.png?asset' {
  const src: string
  export default src
}


interface ImportMetaEnv {
  /** Set to 'true' by vite.web.config.ts for the browser preview build. */
  readonly VITE_WORKSPACE_MANAGER_WEB_PREVIEW?: string
}
