import type { LinkGrabberMoveRequest } from '@manelly/shared';

/** A package as far as ticking goes – of the link grabber or the download list. */
export interface SelectablePackage {
  uuid: number;
  childCount: number;
  /** Missing when JDownloader reported no parts: then only the package as a whole can be ticked. */
  links?: ReadonlyArray<{ uuid: number }>;
}

/** What is ticked: whole packages, and single links of the other packages. */
export interface PackageSelection {
  packages: ReadonlySet<number>;
  links: ReadonlySet<number>;
}

export type TickState = 'all' | 'some' | 'none';

/** Where the last click went – a package, or a link in one; a shift-click reaches from there. */
export type SelectionAnchor = { package: number; link: number | null } | null;

export const NOTHING_SELECTED: PackageSelection = { packages: new Set(), links: new Set() };

export const isEmpty = (selection: PackageSelection): boolean => selection.packages.size === 0 && selection.links.size === 0;

const linksOf = (pkg: SelectablePackage) => pkg.links ?? [];

/** A package is ticked as a whole, in part (some of its links), or not at all. */
export function packageState(selection: PackageSelection, pkg: SelectablePackage): TickState {
  if (selection.packages.has(pkg.uuid)) return 'all';
  return linksOf(pkg).some((link) => selection.links.has(link.uuid)) ? 'some' : 'none';
}

export const linkSelected = (selection: PackageSelection, pkg: SelectablePackage, uuid: number): boolean =>
  selection.packages.has(pkg.uuid) || selection.links.has(uuid);

/** Ticks or unticks a whole package, with all its links. */
export function setPackage(selection: PackageSelection, pkg: SelectablePackage, selected: boolean): PackageSelection {
  const packages = new Set(selection.packages);
  const links = new Set(selection.links);
  for (const link of linksOf(pkg)) links.delete(link.uuid);
  if (selected) packages.add(pkg.uuid);
  else packages.delete(pkg.uuid);
  return { packages, links };
}

/** Ticks a whole package – also one ticked in part – or unticks it with all its links. */
export const togglePackage = (selection: PackageSelection, pkg: SelectablePackage): PackageSelection =>
  setPackage(selection, pkg, packageState(selection, pkg) !== 'all');

/**
 * Ticks or unticks links of one package. Unticking a link of a ticked package leaves its other links ticked; with
 * every link ticked, the package counts as a whole, so links JDownloader still adds to it go along.
 */
export function setLinks(selection: PackageSelection, pkg: SelectablePackage, uuids: readonly number[], selected: boolean): PackageSelection {
  const packages = new Set(selection.packages);
  const links = new Set(selection.links);
  const all = linksOf(pkg);
  if (packages.delete(pkg.uuid)) for (const link of all) links.add(link.uuid);
  for (const uuid of uuids) {
    if (selected) links.add(uuid);
    else links.delete(uuid);
  }
  if (all.length >= pkg.childCount && all.length > 0 && all.every((link) => links.has(link.uuid))) {
    for (const link of all) links.delete(link.uuid);
    packages.add(pkg.uuid);
  }
  return { packages, links };
}

export const toggleLink = (selection: PackageSelection, pkg: SelectablePackage, uuid: number): PackageSelection =>
  setLinks(selection, pkg, [uuid], !linkSelected(selection, pkg, uuid));

/** The items from `from` to `to`, both included, in the order shown; just `to` when `from` is not shown. */
export function range<T>(order: readonly T[], from: T | null, to: T): T[] {
  const start = from === null ? -1 : order.indexOf(from);
  const end = order.indexOf(to);
  if (start < 0 || end < 0) return [to];
  return order.slice(Math.min(start, end), Math.max(start, end) + 1);
}

/**
 * A click on a package's box ticks or unticks it; with shift held, every package shown from the one clicked before
 * up to this one gets the same.
 */
export function clickPackage<P extends SelectablePackage>(
  selection: PackageSelection,
  shown: readonly P[],
  pkg: P,
  anchor: SelectionAnchor,
  shift: boolean,
): PackageSelection {
  const selected = packageState(selection, pkg) !== 'all';
  const ids = shift && anchor?.link === null ? range(shown.map((each) => each.uuid), anchor.package, pkg.uuid) : [pkg.uuid];
  const byId = new Map(shown.map((each) => [each.uuid, each] as const)).set(pkg.uuid, pkg);
  return ids.reduce((next, id) => setPackage(next, byId.get(id)!, selected), selection);
}

/** A click on a link's box, the same within its package: `shown` are its links in the order shown. */
export function clickLink(
  selection: PackageSelection,
  pkg: SelectablePackage,
  shown: readonly number[],
  uuid: number,
  anchor: SelectionAnchor,
  shift: boolean,
): PackageSelection {
  const selected = !linkSelected(selection, pkg, uuid);
  const ids = shift && anchor?.package === pkg.uuid && anchor.link !== null ? range(shown, anchor.link, uuid) : [uuid];
  return setLinks(selection, pkg, ids, selected);
}

export function allState(selection: PackageSelection, packages: readonly SelectablePackage[]): TickState {
  if (packages.length > 0 && packages.every((pkg) => selection.packages.has(pkg.uuid))) return 'all';
  return isEmpty(selection) ? 'none' : 'some';
}

/** Ticks every package, or – when all are ticked – nothing. */
export function toggleAll(selection: PackageSelection, packages: readonly SelectablePackage[]): PackageSelection {
  return allState(selection, packages) === 'all' ? NOTHING_SELECTED : { packages: new Set(packages.map((pkg) => pkg.uuid)), links: new Set() };
}

/** A group of packages (e.g. the finished downloads): all of them ticked, some, or none. */
export function groupState(selection: PackageSelection, group: readonly SelectablePackage[]): TickState {
  const states = group.map((pkg) => packageState(selection, pkg));
  if (states.length > 0 && states.every((state) => state === 'all')) return 'all';
  return states.some((state) => state !== 'none') ? 'some' : 'none';
}

/** Ticks a whole group, or – when all of it is ticked – unticks it; the other packages stay as they are. */
export const toggleGroup = (selection: PackageSelection, group: readonly SelectablePackage[]): PackageSelection => {
  const selected = groupState(selection, group) !== 'all';
  return group.reduce((next, pkg) => setPackage(next, pkg, selected), selection);
};

/** Only what is still there: JDownloader may have moved or removed something meanwhile. */
export function pruneSelection(selection: PackageSelection, packages: readonly SelectablePackage[]): PackageSelection {
  const packageIds = new Set(packages.map((pkg) => pkg.uuid));
  const linkIds = new Set(packages.flatMap((pkg) => linksOf(pkg).map((link) => link.uuid)));
  const kept = {
    packages: new Set([...selection.packages].filter((id) => packageIds.has(id))),
    links: new Set([...selection.links].filter((id) => linkIds.has(id))),
  };
  return kept.packages.size === selection.packages.size && kept.links.size === selection.links.size ? selection : kept;
}

/** How many links the selection takes in. */
export function selectedLinks(selection: PackageSelection, packages: readonly SelectablePackage[]): number {
  return packages.reduce(
    (sum, pkg) => sum + (selection.packages.has(pkg.uuid) ? pkg.childCount : linksOf(pkg).filter((link) => selection.links.has(link.uuid)).length),
    0,
  );
}

const count = (n: number, [one, many]: readonly [string, string]) => `${n} ${n === 1 ? one : many}`;

/** "2 Pakete mit 13 Dateien und 4 einzelne Dateien": what a selection takes in, in the words for what is counted. */
export function describeSelection(
  packages: number,
  inPackages: number,
  single: number,
  words: { item: readonly [string, string]; single: readonly [string, string] },
): string {
  const parts = [packages > 0 ? `${count(packages, ['Paket', 'Pakete'])} mit ${count(inPackages, words.item)}` : null, single > 0 ? count(single, words.single) : null];
  return parts.filter(Boolean).join(' und ');
}

export const selectionRequest = (selection: PackageSelection): LinkGrabberMoveRequest => ({
  packageIds: [...selection.packages],
  linkIds: [...selection.links],
});
