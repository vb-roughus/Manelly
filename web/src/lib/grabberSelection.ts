import type { LinkGrabberMoveRequest, LinkGrabberPackage } from '@manelly/shared';

/** What is ticked in the link grabber: whole packages, and single links of the other packages. */
export interface GrabberSelection {
  packages: ReadonlySet<number>;
  links: ReadonlySet<number>;
}

export type TickState = 'all' | 'some' | 'none';

export const NOTHING_SELECTED: GrabberSelection = { packages: new Set(), links: new Set() };

export const isEmpty = (selection: GrabberSelection): boolean => selection.packages.size === 0 && selection.links.size === 0;

/** A package is ticked as a whole, in part (some of its links), or not at all. */
export function packageState(selection: GrabberSelection, pkg: LinkGrabberPackage): TickState {
  if (selection.packages.has(pkg.uuid)) return 'all';
  return pkg.links.some((link) => selection.links.has(link.uuid)) ? 'some' : 'none';
}

export const linkSelected = (selection: GrabberSelection, pkg: LinkGrabberPackage, uuid: number): boolean =>
  selection.packages.has(pkg.uuid) || selection.links.has(uuid);

/** Ticks a whole package – also one ticked in part – or unticks it with all its links. */
export function togglePackage(selection: GrabberSelection, pkg: LinkGrabberPackage): GrabberSelection {
  const packages = new Set(selection.packages);
  const links = new Set(selection.links);
  for (const link of pkg.links) links.delete(link.uuid);
  if (packageState(selection, pkg) === 'all') packages.delete(pkg.uuid);
  else packages.add(pkg.uuid);
  return { packages, links };
}

/**
 * Ticks or unticks one link. Unticking a link of a ticked package leaves its other links ticked; ticking the last
 * one ticks the package as a whole, so links JDownloader still adds to it go along.
 */
export function toggleLink(selection: GrabberSelection, pkg: LinkGrabberPackage, uuid: number): GrabberSelection {
  const packages = new Set(selection.packages);
  const links = new Set(selection.links);
  if (packages.delete(pkg.uuid)) {
    for (const link of pkg.links) if (link.uuid !== uuid) links.add(link.uuid);
  } else if (!links.delete(uuid)) {
    links.add(uuid);
  }
  if (pkg.links.length >= pkg.childCount && pkg.links.length > 0 && pkg.links.every((link) => links.has(link.uuid))) {
    for (const link of pkg.links) links.delete(link.uuid);
    packages.add(pkg.uuid);
  }
  return { packages, links };
}

export function allState(selection: GrabberSelection, packages: LinkGrabberPackage[]): TickState {
  if (packages.length > 0 && packages.every((pkg) => selection.packages.has(pkg.uuid))) return 'all';
  return isEmpty(selection) ? 'none' : 'some';
}

/** Ticks every package, or – when all are ticked – nothing. */
export function toggleAll(selection: GrabberSelection, packages: LinkGrabberPackage[]): GrabberSelection {
  return allState(selection, packages) === 'all' ? NOTHING_SELECTED : { packages: new Set(packages.map((pkg) => pkg.uuid)), links: new Set() };
}

/** Only what is still in the link grabber: JDownloader may have moved or removed something meanwhile. */
export function pruneSelection(selection: GrabberSelection, packages: LinkGrabberPackage[]): GrabberSelection {
  const packageIds = new Set(packages.map((pkg) => pkg.uuid));
  const linkIds = new Set(packages.flatMap((pkg) => pkg.links.map((link) => link.uuid)));
  const kept = {
    packages: new Set([...selection.packages].filter((id) => packageIds.has(id))),
    links: new Set([...selection.links].filter((id) => linkIds.has(id))),
  };
  return kept.packages.size === selection.packages.size && kept.links.size === selection.links.size ? selection : kept;
}

/** How many links the selection moves. */
export function selectedLinks(selection: GrabberSelection, packages: LinkGrabberPackage[]): number {
  return packages.reduce(
    (sum, pkg) => sum + (selection.packages.has(pkg.uuid) ? pkg.childCount : pkg.links.filter((link) => selection.links.has(link.uuid)).length),
    0,
  );
}

export const selectionRequest = (selection: GrabberSelection): LinkGrabberMoveRequest => ({
  packageIds: [...selection.packages],
  linkIds: [...selection.links],
});
