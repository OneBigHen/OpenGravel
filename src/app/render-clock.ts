/**
 * The instant a server-rendered page was built, read once per request.
 *
 * A live page's relative times ("updated 40 s ago") are only honest if the page
 * knows when it rendered, and a server component may not call an impure function
 * while rendering (React's purity rule). This is that one read, named so the
 * page's intent is explicit: the value describes *this response*, and the client
 * surface replaces it with the viewer's own clock as soon as it takes over.
 */
export function renderInstant(): number {
  return Date.now();
}
