import { BadRequestException } from "@nestjs/common";

export function searchOptions(values: unknown, fallback: string | undefined, label: string): string[] {
  const source = values === undefined ? (fallback ?? "").split(",") : values;
  if (!Array.isArray(source) || source.some(value => typeof value !== "string")) throw new BadRequestException(`${label} must be a list of text values.`);
  const unique = new Map<string, string>();
  for (const item of source as string[]) {
    const value = item.trim();
    if (value.length > 120) throw new BadRequestException(`${label} entries must be under 120 characters.`);
    if (value) unique.set(value.toLowerCase(), value);
  }
  if (!unique.size) throw new BadRequestException(`Enter at least one entry for ${label.toLowerCase()}.`);
  return [...unique.values()];
}

export function searchCombinations(profile: { targetRoles?: string[] | null; locations?: string[] | null; targetRole: string; location: string }) {
  const roles = searchOptions(profile.targetRoles ?? undefined, profile.targetRole, "Roles");
  const locations = searchOptions(profile.locations ?? undefined, profile.location || "Remote", "Locations");
  return roles.flatMap(role => locations.map(location => ({ role, location })));
}
