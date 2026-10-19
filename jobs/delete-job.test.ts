import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { JobsService } from "./jobs.service";

function setup(authorized: boolean) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const manager = { query: async (sql: string, params: unknown[]) => {
    calls.push({ sql, params });
    return sql.startsWith("SELECT") && authorized ? [{ id: "job-1" }] : [];
  } };
  const service = new JobsService({ manager: { transaction: async (action: (value: typeof manager) => unknown) => action(manager) } } as never, {} as never, {} as never, {} as never, {} as never);
  return { service, calls };
}
test("deletes the authorized user's job and matches in one transaction", async () => {
  const { service, calls } = setup(true);
  assert.deepEqual(await service.deleteSavedJob("user-1", "job-1"), { deleted: true, id: "job-1" });
  assert.ok(calls[0].sql.includes("FOR UPDATE"));
  assert.ok(calls.every(call => call.params[0] === "job-1" && call.params[1] === "user-1"));
  assert.ok(calls.some(call => call.sql.startsWith("DELETE FROM job_matches") && call.sql.includes('"userId" = $2')));
  assert.ok(calls.some(call => call.sql.startsWith("DELETE FROM jobs") && call.sql.includes("NOT EXISTS")));
});
test("another user's job cannot be deleted", async () => {
  const { service, calls } = setup(false);
  await assert.rejects(service.deleteSavedJob("other-user", "job-1"), /Saved job not found/);
  assert.equal(calls.length, 1);
});
test("shared legacy jobs are detached from the owner and retained for other users", async () => {
  const { service, calls } = setup(true);
  await service.deleteSavedJob("user-1", "job-1");
  assert.ok(calls.some(call => call.sql.includes('SET "userId" = NULL') && call.sql.includes("AND EXISTS")));
});
