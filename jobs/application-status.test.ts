import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { JobsService } from "./jobs.service";
import { applicationStatuses } from "../entities/job-application.entity";

function setup(authorized = true) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const service = new JobsService({ query: async (sql: string, params: unknown[]) => {
    calls.push({ sql, params });
    return authorized ? [{ id: params[0], applicationStatus: params[2], statusUpdatedAt: "2026-10-19T00:00:00Z" }] : [];
  } } as never, {} as never, {} as never, {} as never, {} as never);
  return { service, calls };
}

test("each supported status is persisted for the signed-in user only", async () => {
  const { service, calls } = setup();
  for (const status of applicationStatuses) {
    const result = await service.updateApplicationStatus("user-a", "job-a", status);
    assert.equal(result.applicationStatus, status);
    const call = calls.at(-1)!;
    assert.deepEqual(call.params, ["job-a", "user-a", status]);
    assert.ok(call.sql.includes('job."userId" = $2'));
    assert.ok(call.sql.includes('m."userId" = $2'));
    assert.ok(call.sql.includes('ON CONFLICT ("userId", "jobId")'));
  }
});

test("invalid status makes no database changes", async () => {
  const { service, calls } = setup();
  for (const status of [undefined, null, "unknown", {}, "APPLIED"]) {
    await assert.rejects(service.updateApplicationStatus("user-a", "job-a", status), /Invalid application status/);
  }
  assert.equal(calls.length, 0);
});

test("missing jobs and jobs belonging to other users cannot be updated", async () => {
  const { service } = setup(false);
  await assert.rejects(service.updateApplicationStatus("other-user", "job-a", "applied"), /Saved job not found/);
});
