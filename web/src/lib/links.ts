/** "wiki.example.org/x" as https://wiki.example.org/x; an address with a scheme stays as it is, the server checks it. */
export function withScheme(url: string): string {
  const trimmed = url.trim();
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) || /^(javascript|data|mailto|file):/i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** What shows when the pointer rests on a link: its description, else where it leads. */
export function linkHint(link: { description: string; url: string }): string {
  if (link.description) return link.description;
  try {
    return new URL(link.url).host;
  } catch {
    return link.url;
  }
}
