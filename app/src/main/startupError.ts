/** The text of the dialog shown when the app can't start: what failed, where, and the error's own words. */
export function startupErrorText(what: string, path: string, err: unknown): string {
  return `${what}\n\n${path}\n\n${err instanceof Error ? err.message : String(err)}`
}
