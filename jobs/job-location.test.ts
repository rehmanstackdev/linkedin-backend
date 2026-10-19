import assert from "node:assert/strict";
import { test } from "node:test";
import { matchesSavedLocation, savedLocations } from "./job-location";

test("Pakistan excludes unrelated countries and unknown locations", () => {
  const allowed = savedLocations({ locations: ["Pakistan"] });
  assert.ok(matchesSavedLocation("Lahore, Punjab, Pakistan", allowed));
  assert.ok(matchesSavedLocation("Pakistan (Remote)", allowed));
  assert.equal(matchesSavedLocation("Sydney, Australia", allowed), false);
  assert.equal(matchesSavedLocation("United States", allowed), false);
  assert.equal(matchesSavedLocation(undefined, allowed), false);
  assert.equal(matchesSavedLocation("Remote", allowed), false);
});
test("matches complete place names rather than substrings", () => {
  const allowed = savedLocations({ locations: ["York"] });
  assert.ok(matchesSavedLocation("York, United Kingdom", allowed));
  assert.equal(matchesSavedLocation("Yorkshire, United Kingdom", allowed), false);
});
test("multiple saved locations are alternatives", () => {
  const allowed = savedLocations({ locations: ["Lahore", "Karachi"] });
  assert.ok(matchesSavedLocation("Lahore, Pakistan", allowed));
  assert.ok(matchesSavedLocation("Karachi, Pakistan", allowed));
  assert.equal(matchesSavedLocation("Islamabad, Pakistan", allowed), false);
});
