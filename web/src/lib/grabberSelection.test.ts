import { describe, expect, it } from 'vitest';
import type { LinkGrabberPackage } from '@manelly/shared';
import {
  allState,
  linkSelected,
  NOTHING_SELECTED,
  packageState,
  pruneSelection,
  selectedLinks,
  selectionRequest,
  toggleAll,
  toggleLink,
  togglePackage,
} from './grabberSelection';

const pkg = (uuid: number, links: number[], childCount = links.length): LinkGrabberPackage => ({
  uuid,
  name: `Paket ${uuid}`,
  bytesTotal: 0,
  childCount,
  hosts: [],
  saveTo: null,
  enabled: true,
  online: links.length,
  offline: 0,
  unknown: 0,
  links: links.map((id) => ({ uuid: id, name: `${id}.rar`, bytesTotal: 0, host: null, availability: 'ONLINE', enabled: true })),
});

const dune = pkg(1, [11, 12, 13]);
const shogun = pkg(2, [21, 22]);
const packages = [dune, shogun];

describe('link grabber selection', () => {
  it('ticks whole packages and unticks them with their links', () => {
    let selection = togglePackage(NOTHING_SELECTED, dune);
    expect(packageState(selection, dune)).toBe('all');
    expect(linkSelected(selection, dune, 12)).toBe(true);
    expect(selectionRequest(selection)).toEqual({ packageIds: [1], linkIds: [] });
    selection = togglePackage(selection, dune);
    expect(packageState(selection, dune)).toBe('none');
    expect(selectionRequest(selection)).toEqual({ packageIds: [], linkIds: [] });
  });

  it('moves single links, also the rest of a package after unticking one', () => {
    // E.g. the offline part of an otherwise complete package.
    let selection = toggleLink(togglePackage(NOTHING_SELECTED, dune), dune, 13);
    expect(packageState(selection, dune)).toBe('some');
    expect(selectionRequest(selection)).toEqual({ packageIds: [], linkIds: [11, 12] });
    selection = toggleLink(selection, shogun, 22);
    expect(selectedLinks(selection, packages)).toBe(3);
    expect(selectionRequest(selection)).toEqual({ packageIds: [], linkIds: [11, 12, 22] });
  });

  it('counts a package with every link ticked as the package itself', () => {
    let selection = toggleLink(NOTHING_SELECTED, shogun, 21);
    selection = toggleLink(selection, shogun, 22);
    expect(selectionRequest(selection)).toEqual({ packageIds: [2], linkIds: [] });
    // Not when JDownloader has not reported all its links yet.
    const partial = pkg(3, [31], 4);
    expect(selectionRequest(toggleLink(NOTHING_SELECTED, partial, 31))).toEqual({ packageIds: [], linkIds: [31] });
  });

  it('ticks a package ticked in part as a whole', () => {
    const selection = togglePackage(toggleLink(NOTHING_SELECTED, dune, 11), dune);
    expect(selectionRequest(selection)).toEqual({ packageIds: [1], linkIds: [] });
  });

  it('ticks all, or nothing when all are ticked', () => {
    expect(allState(NOTHING_SELECTED, packages)).toBe('none');
    const all = toggleAll(NOTHING_SELECTED, packages);
    expect(allState(all, packages)).toBe('all');
    expect(selectedLinks(all, packages)).toBe(5);
    expect(allState(toggleLink(all, dune, 11), packages)).toBe('some');
    expect(toggleAll(all, packages)).toBe(NOTHING_SELECTED);
    expect(toggleAll(toggleLink(NOTHING_SELECTED, dune, 11), packages).packages).toEqual(new Set([1, 2]));
  });

  it('forgets what left the link grabber', () => {
    const selection = toggleLink(togglePackage(NOTHING_SELECTED, dune), shogun, 21);
    expect(pruneSelection(selection, packages)).toBe(selection);
    expect(selectionRequest(pruneSelection(selection, [pkg(2, [22])]))).toEqual({ packageIds: [], linkIds: [] });
  });
});
