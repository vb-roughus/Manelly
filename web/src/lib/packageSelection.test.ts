import { describe, expect, it } from 'vitest';
import type { LinkGrabberPackage } from '@manelly/shared';
import {
  allState,
  clickLink,
  clickPackage,
  describeSelection,
  groupState,
  linkSelected,
  NOTHING_SELECTED,
  packageState,
  pruneSelection,
  range,
  selectedLinks,
  selectionRequest,
  toggleAll,
  toggleGroup,
  toggleLink,
  togglePackage,
} from './packageSelection';

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

describe('the selection in words', () => {
  const files = { item: ['Datei', 'Dateien'], single: ['einzelne Datei', 'einzelne Dateien'] } as const;
  it('names whole packages and single files', () => {
    expect(describeSelection(4, 13, 4, files)).toBe('4 Pakete mit 13 Dateien und 4 einzelne Dateien');
    expect(describeSelection(1, 1, 0, files)).toBe('1 Paket mit 1 Datei');
    expect(describeSelection(0, 0, 1, { item: ['Link', 'Links'], single: ['einzelner Link', 'einzelne Links'] })).toBe('1 einzelner Link');
  });
});

describe('ranges with shift', () => {
  const show = (uuid: number) => pkg(uuid, [uuid * 10 + 1, uuid * 10 + 2, uuid * 10 + 3, uuid * 10 + 4]);
  const list = [show(1), show(2), show(3), show(4), show(5)];

  it('takes the ids between two clicks in the order shown, either way round', () => {
    expect(range([5, 3, 9, 1], 3, 1)).toEqual([3, 9, 1]);
    expect(range([5, 3, 9, 1], 1, 3)).toEqual([3, 9, 1]);
    expect(range([5, 3, 9, 1], null, 9)).toEqual([9]);
    expect(range([5, 3, 9, 1], 7, 9)).toEqual([9]);
  });

  it('ticks the packages from the last click up to a shift-click, and unticks them the same way', () => {
    let selection = clickPackage(NOTHING_SELECTED, list, list[1]!, null, false);
    selection = clickPackage(selection, list, list[3]!, { package: 2, link: null }, true);
    expect(selectionRequest(selection).packageIds).toEqual([2, 3, 4]);
    // The state of the package clicked decides: ticked ones are unticked.
    selection = clickPackage(selection, list, list[2]!, { package: 4, link: null }, true);
    expect(selectionRequest(selection).packageIds).toEqual([2]);
    // Without shift, or after a click on a link, only the one.
    expect(selectionRequest(clickPackage(NOTHING_SELECTED, list, list[4]!, { package: 1, link: null }, false)).packageIds).toEqual([5]);
    expect(selectionRequest(clickPackage(NOTHING_SELECTED, list, list[4]!, { package: 1, link: 11 }, true)).packageIds).toEqual([5]);
  });

  it('ticks the links of one package from the last click up to a shift-click', () => {
    const [first, second] = list as [ReturnType<typeof show>, ReturnType<typeof show>];
    const shown = first.links.map((link) => link.uuid);
    let selection = clickLink(NOTHING_SELECTED, first, shown, 12, null, false);
    selection = clickLink(selection, first, shown, 14, { package: 1, link: 12 }, true);
    expect(selectionRequest(selection).linkIds).toEqual([12, 13, 14]);
    // All four: the package as a whole.
    selection = clickLink(selection, first, shown, 11, { package: 1, link: 14 }, true);
    expect(selectionRequest(selection)).toEqual({ packageIds: [1], linkIds: [] });
    // The last click was in another package: just this link.
    expect(selectionRequest(clickLink(NOTHING_SELECTED, second, [21, 22, 23, 24], 23, { package: 1, link: 12 }, true)).linkIds).toEqual([23]);
  });

  it('ticks a group of packages, also packages without reported parts', () => {
    const finished = [{ uuid: 7, childCount: 3 }, { uuid: 8, childCount: 1 }];
    let selection = toggleGroup(NOTHING_SELECTED, finished);
    expect(groupState(selection, finished)).toBe('all');
    selection = clickPackage(selection, finished, finished[0]!, null, false);
    expect(groupState(selection, finished)).toBe('some');
    expect(selectionRequest(toggleGroup(selection, finished)).packageIds).toEqual([8, 7]);
    expect(groupState(toggleGroup(toggleGroup(selection, finished), finished), finished)).toBe('none');
  });
});
