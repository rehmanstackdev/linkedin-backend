import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { searchOptions, searchCombinations } from "./search-options";

test("normalizes and deduplicates multiple roles", () => {
  assert.deepEqual(searchOptions([" Frontend Developer ", "Backend Developer", "frontend developer"], undefined, "Roles"), ["frontend developer", "Backend Developer"]);
});
test("searches every role in every location", () => {
  assert.deepEqual(searchCombinations({ targetRole: "legacy", location: "legacy", targetRoles: ["Frontend Developer", "Backend Developer"], locations: ["Remote", "Lahore"] }), [
    { role: "Frontend Developer", location: "Remote" }, { role: "Frontend Developer", location: "Lahore" },
    { role: "Backend Developer", location: "Remote" }, { role: "Backend Developer", location: "Lahore" },
  ]);
});
test("existing single-role profiles remain usable", () => {
  assert.deepEqual(searchCombinations({ targetRole: "Developer", location: "Remote" }), [{ role: "Developer", location: "Remote" }]);
});
test("rejects empty and invalid lists", () => {
  assert.throws(() => searchOptions([], undefined, "Roles"));
  assert.throws(() => searchOptions([123], undefined, "Roles"));
});

test("accepts more than five roles and locations without truncating combinations", () => {
  const roles = ["MERN Developer", "Next.js Developer", "NestJS Developer", "Frontend Developer", "Software Engineer", "React Developer"];
  const locations = ["Lahore", "Islamabad", "Rawalpindi", "Multan", "Bahawalpur", "Rahim Yar Khan"];
  assert.deepEqual(searchOptions(roles, undefined, "Roles"), roles);
  assert.deepEqual(searchOptions(locations, undefined, "Locations"), locations);
  const combinations = searchCombinations({ targetRole: "", location: "", targetRoles: roles, locations });
  assert.equal(combinations.length, 36);
  assert.deepEqual(combinations.at(-1), { role: "React Developer", location: "Rahim Yar Khan" });
});
