export function normalizeLocation(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
export function savedLocations(profile?: { locations?: string[] | null; location?: string } | null) {
  return (profile?.locations?.length ? profile.locations : (profile?.location ?? "").split(","))
    .map(normalizeLocation).filter(Boolean);
}
export function matchesSavedLocation(location: string | undefined, allowed: string[]) {
  const normalized = ` ${normalizeLocation(location ?? "")} `;
  return allowed.some(value => normalized.includes(` ${value} `));
}
