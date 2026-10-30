/** Lower case without accents: "Haus des Geldes" and "Haus des Géldes" read the same. */
export const plain = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** The items whose label holds every word typed, in any order: "expanse the" finds "The Expanse". */
export function filterByWords<T extends { label: string }>(items: readonly T[], query: string): T[] {
  const words = plain(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...items];
  return items.filter((item) => {
    const label = plain(item.label);
    return words.every((word) => label.includes(word));
  });
}
