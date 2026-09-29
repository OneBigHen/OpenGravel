// Fixture: Rule B — a provider URL literal is a direct provider dependency even
// when no module is imported. TomTom is named in this comment to prove that
// comment text is masked and never reported.
export function searchUrl(query: string): string {
  return "https://api.tomtom.com/search/2/search/" + encodeURIComponent(query);
}
