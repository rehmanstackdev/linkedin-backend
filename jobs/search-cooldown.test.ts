import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { JobsService } from "./jobs.service";

function setup() {
  let reserved = false;
  let calls = 0;
  const nextFetchAt = new Date(Date.now() + 7200000);
  const service = new JobsService(
    { query: async (sql: string) => {
      if (sql.startsWith("INSERT")) {
        if (reserved) return [];
        reserved = true; return [{ nextFetchAt }];
      }
      return [{ nextFetchAt }];
    } } as never,
    { find: async () => [] } as never,
    { findOne: async () => ({ targetRole: "Developer", skills: ["React"] }) } as never,
    { findOne: async () => ({ id: "user-1" }) } as never,
    { get: () => "configured" } as never,
  );
  Object.assign(service, { fetchFromApify: async () => { calls++; return []; } });
  return { service, calls: () => calls };
}
test("a successful empty search still reserves the full two-hour window", async () => {
  const { service, calls } = setup();
  const first = await service.fetchAndMatch("user-1");
  const second = await service.fetchAndMatch("user-1");
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.equal(calls(), 1);
  assert.equal(new Date(first.nextFetchAt).getTime(), new Date(second.nextFetchAt).getTime());
});
test("overlapping searches only call Apify once", async () => {
  const { service, calls } = setup();
  const results = await Promise.all([service.fetchAndMatch("user-1"), service.fetchAndMatch("user-1")]);
  assert.equal(results.filter(result => !result.cached).length, 1);
  assert.equal(calls(), 1);
});
test("an actor failure cannot be retried repeatedly during the credit window", async () => {
  const { service } = setup();
  Object.assign(service, { fetchFromApify: async () => { throw new Error("Actor failed"); } });
  await assert.rejects(service.fetchAndMatch("user-1"), /Actor failed/);
  assert.equal((await service.fetchAndMatch("user-1")).cached, true);
});
