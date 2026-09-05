/// <reference types="vite/client" />

declare module 'virtual:story-lab-retry' {
  export const buildId: string;
  export const mapPath: string;
}

interface ImportMetaEnv {
  /**
   * Origin the api client (src/api/client.ts) prefixes onto every request
   * path. Unset in dev/test — requests resolve against the current
   * origin. Set in production (apps/web's Pages deploy) to the API's own
   * origin, since the static site and the API are deployed separately —
   * see docs/deploy.md.
   */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
