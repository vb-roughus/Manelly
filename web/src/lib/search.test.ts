import { describe, expect, it } from 'vitest';
import { filterByWords } from './search';

const items = ['The Expanse (2015)', 'Dark (2017)', 'Haus des Geldes', 'Café Fürstenberg', 'Expedition Arktis'].map((label) => ({ label }));

describe('search by words', () => {
  it('finds every word typed, in any order, without regard to case or accents', () => {
    expect(filterByWords(items, 'expanse the').map((item) => item.label)).toEqual(['The Expanse (2015)']);
    expect(filterByWords(items, 'exp').map((item) => item.label)).toEqual(['The Expanse (2015)', 'Expedition Arktis']);
    expect(filterByWords(items, 'cafe furst').map((item) => item.label)).toEqual(['Café Fürstenberg']);
    expect(filterByWords(items, '2017').map((item) => item.label)).toEqual(['Dark (2017)']);
    expect(filterByWords(items, 'xyz')).toEqual([]);
    expect(filterByWords(items, '  ')).toHaveLength(5);
  });
});
