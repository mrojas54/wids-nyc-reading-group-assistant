export const PREVIEW_HARNESS_PATH = "/preview/paperpal";

export function isPreviewHarnessPath(path: string) {
  return path === PREVIEW_HARNESS_PATH || path.startsWith(`${PREVIEW_HARNESS_PATH}/`);
}

export function previewHarnessAllowed(host: string | null) {
  if (process.env.VERCEL_ENV !== "preview" || !host) return false;
  // A promoted preview must not expose the harness through a production alias.
  return [process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL]
    .some(allowed => allowed?.endsWith(".vercel.app") && host === allowed);
}
