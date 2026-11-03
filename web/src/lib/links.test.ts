import { describe, expect, it } from 'vitest';
import { linkHint, withScheme } from './links';

describe('links in the menu', () => {
  it('adds https:// to an address without one', () => {
    expect(withScheme(' wiki.example.org/docs ')).toBe('https://wiki.example.org/docs');
    expect(withScheme('http://nas.local:8080')).toBe('http://nas.local:8080');
    expect(withScheme('HTTPS://Example.org')).toBe('HTTPS://Example.org');
    // Left for the server to refuse.
    expect(withScheme('javascript:alert(1)')).toBe('javascript:alert(1)');
    expect(withScheme('ftp://files.example.org')).toBe('ftp://files.example.org');
  });

  it('hints the description, else the host', () => {
    expect(linkHint({ description: 'Offizielle Doku', url: 'https://jellyfin.org/docs/' })).toBe('Offizielle Doku');
    expect(linkHint({ description: '', url: 'https://jellyfin.org/docs/' })).toBe('jellyfin.org');
  });
});
