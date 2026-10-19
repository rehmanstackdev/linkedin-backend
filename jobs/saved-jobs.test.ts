import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { JobsService } from "./jobs.service";

function setup() {
  const calls: { method: string; args: unknown[] }[] = [];
  const query: Record<string, (...args: unknown[]) => unknown> = {};
  for (const method of ["where", "andWhere", "orderBy", "addOrderBy", "skip", "take"]) {
    query[method] = (...args) => { calls.push({ method, args }); return query; };
  }
  query.getManyAndCount = async () => [[{ id: "saved-job" }], 21];
  const service = new JobsService({ createQueryBuilder: () => query, query: async (sql: string, params: unknown[]) => {
    calls.push({ method: "query", args: [sql, params] });
    return sql.includes("FROM job_applications") ? [{ jobId: "saved-job", status: "applied", updatedAt: "2026-10-19T00:00:00Z" }] : [];
  } } as never, {} as never, { findOne: async () => ({ locations: ["Pakistan"] }) } as never, {} as never, {} as never);
  return { service, calls };
}
test("all saved jobs are scoped to the signed-in user and paginated", async () => {
  const { service, calls } = setup();
  const result = await service.savedJobs("user-a", "all", 2, "developer");
  assert.equal(result.total, 21);
  assert.equal(result.items[0].applicationStatus, "applied");
  assert.ok(calls.some(call => call.method === "query" && String(call.args[0]).includes("FROM job_applications") && (call.args[1] as unknown[])[0] === "user-a"));
  assert.ok(String(calls[0].args[0]).includes('job."userId" = :userId'));
  assert.deepEqual(calls[0].args[1], { userId: "user-a" });
  assert.ok(calls.some(call => call.method === "andWhere" && String(call.args[0]).includes("strpos") && (call.args[1] as Record<string, string>)?.location0 === " pakistan "));
  assert.ok(calls.some(call => call.method === "skip" && call.args[0] === 20));
  assert.ok(calls.some(call => call.method === "andWhere" && String(call.args[0]).includes("ILIKE")));
  assert.ok(!calls.some(call => call.method === "andWhere" && String(call.args[0]).includes("postedAt")));
});
test("recent jobs use posting dates in the last two hours", async () => {
  const { service, calls } = setup();
  await service.savedJobs("user-a", "2hours");
  const filter = calls.find(call => call.method === "andWhere" && String(call.args[0]).includes("postedAt"));
  assert.ok(filter);
  const { since, now } = filter.args[1] as { since: Date; now: Date };
  assert.equal(now.getTime() - since.getTime(), 2 * 60 * 60 * 1000);
  assert.ok(String(filter.args[0]).includes('job."postedAt" <= :now'));
});
test("invalid periods and pages are rejected", async () => {
  const { service } = setup();
  await assert.rejects(service.savedJobs("user-a", "unknown"), /Invalid job period/);
  await assert.rejects(service.savedJobs("user-a", "all", -1), /positive integer/);
});

test("table sorting and filters apply before database pagination", async () => {
  const { service, calls } = setup();
  const result = await service.savedJobs("user-a", "all", 2, "React", { company: "Acme", location: "Lahore", sort: "company", direction: "asc", size: 50 });
  assert.equal(result.pageSize, 50);
  assert.ok(calls.some(call => call.method === "orderBy" && call.args[0] === 'job."company"' && call.args[1] === "ASC"));
  assert.ok(calls.some(call => call.method === "skip" && call.args[0] === 50));
  assert.ok(calls.some(call => call.method === "andWhere" && (call.args[1] as Record<string, string>)?.company === "%Acme%"));
  assert.ok(calls.some(call => call.method === "andWhere" && (call.args[1] as Record<string, string>)?.location === "%Lahore%"));
});
test("table sort columns and page sizes are allowlisted", async () => {
  const { service } = setup();
  await assert.rejects(service.savedJobs("user-a", "all", 1, "", { sort: "title; DROP TABLE jobs" }), /Invalid sort/);
  await assert.rejects(service.savedJobs("user-a", "all", 1, "", { size: 100000 }), /Invalid page size/);
});
