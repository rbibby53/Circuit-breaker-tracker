export const LOCATION_KINDS = ['company', 'site', 'building', 'floor', 'room'] as const;
export type LocationKind = (typeof LOCATION_KINDS)[number];

/** Which kind each kind must sit under. Companies are top level. */
export const PARENT_KIND: Record<LocationKind, LocationKind | null> = {
  company: null,
  site: 'company',
  building: 'site',
  floor: 'building',
  room: 'floor',
};

export const CHILD_KIND: Record<LocationKind, LocationKind | null> = {
  company: 'site',
  site: 'building',
  building: 'floor',
  floor: 'room',
  room: null,
};

export const KIND_LABELS: Record<LocationKind, string> = {
  company: 'Company',
  site: 'Site',
  building: 'Building',
  floor: 'Floor',
  room: 'Room',
};

/** Minimal shape of a location needed for access checks. */
export interface LocationNode {
  id: number;
  parentId: number | null;
  kind: LocationKind;
  /** Materialised ancestor path including the node itself, e.g. "/1/4/9/". */
  path: string;
}

export function makePath(parentPath: string | null, id: number): string {
  return `${parentPath ?? '/'}${id}/`;
}

/** Ancestor ids from the root down to and including the node itself. */
export function pathIds(path: string): number[] {
  return path
    .split('/')
    .filter(Boolean)
    .map((s) => Number(s));
}

/** True when `node` is `ancestorId` itself or anywhere inside it. */
export function isWithin(node: Pick<LocationNode, 'path'>, ancestorId: number): boolean {
  return node.path.includes(`/${ancestorId}/`);
}
