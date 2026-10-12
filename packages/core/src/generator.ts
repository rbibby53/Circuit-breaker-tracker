// Standby generators: where they are, what they are, and which panels they back up.

export const FUELS = ['diesel', 'natural-gas', 'propane', 'bi-fuel', 'gasoline', 'other'] as const;
export type Fuel = (typeof FUELS)[number];

export const FUEL_LABELS: Record<Fuel, string> = {
  diesel: 'Diesel',
  'natural-gas': 'Natural gas',
  propane: 'Propane',
  'bi-fuel': 'Bi-fuel',
  gasoline: 'Gasoline',
  other: 'Other',
};

/** "250 kW diesel", "Natural gas", or "" when nothing is known. */
export function generatorRating(g: { kw: number | null; fuel: Fuel }): string {
  const fuel = FUEL_LABELS[g.fuel];
  return g.kw ? `${g.kw} kW ${fuel.toLowerCase()}` : fuel;
}
