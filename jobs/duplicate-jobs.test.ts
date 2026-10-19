import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { JobsService } from "./jobs.service";

type Row = { id?: string; externalId?: string; url?: string; title: string; company?: string; location: string; source: string; user?: { id: string }; applicationStatus?: string };
const job = (overrides: Partial<Row> = {}): Row => ({ externalId: "external-1", url: "https://example.com/jobs/1", title: "React Developer", company: "Example", location: "Lahore", source: "apify", ...overrides });
function setup() {
  const rows: Row[] = [];
  const writes: Row[] = [];
  let batch: Row[] = [];
  const service = new JobsService({
    query: async () => [{ nextFetchAt: new Date() }],
    findOne: async ({ where }: { where: Record<string, unknown>[] }) => rows.find(row => where.some(identity =>
      Object.entries(identity).every(([key, value]) => key === "user" ? row.user?.id === (value as { id: string }).id :
        typeof value === "object" && value !== null ? row[key as keyof Row] == null : row[key as keyof Row] === value))),
    save: async (value: Row) => { const saved = { ...value, id: `job-${rows.length + 1}` }; rows.push(saved); writes.push(saved); return saved; },
  } as never, {} as never,
  { findOne: async () => ({ locations: ["Lahore"], skills: [] }) } as never,
  { findOne: async ({ where }: { where: { id: string } }) => ({ id: where.id }) } as never,
  { get: () => "configured" } as never);
  Object.assign(service, { fetchFromApify: async () => batch, scoreJob: () => ({ score: 0 }) });
  return { service, rows, writes, batch: (value: Row[]) => { batch = value; } };
}

test("a later eligible search saves only new jobs and never rewrites existing rows", async () => {
  const state = setup();
  state.batch([job()]);
  assert.equal((await state.service.fetchAndMatch("user-a")).scraped, 1);
  state.rows[0].applicationStatus = "applied";
  state.batch([job({ title: "Changed title" }), job({ externalId: "external-2", url: "https://example.com/jobs/2" })]);
  assert.equal((await state.service.fetchAndMatch("user-a")).scraped, 1);
  assert.equal(state.writes.length, 2);
  assert.equal(state.rows[0].title, "React Developer");
  assert.equal(state.rows[0].applicationStatus, "applied");
});

test("URL prevents duplicates even if an external ID changes or disappears", async () => {
  const state = setup();
  state.batch([job(), job({ externalId: "changed-id" }), job({ externalId: undefined })]);
  assert.equal((await state.service.fetchAndMatch("user-a")).scraped, 1);
  assert.equal(state.writes.length, 1);
});

test("jobs without an ID or URL are deduplicated by title, company, location and source", async () => {
  const state = setup();
  state.batch([job({ externalId: undefined, url: undefined }), job({ externalId: undefined, url: undefined })]);
  assert.equal((await state.service.fetchAndMatch("user-a")).scraped, 1);
  assert.equal((await state.service.fetchAndMatch("user-a")).scraped, 0);
});

test("two users can independently save the same job", async () => {
  const state = setup();
  state.batch([job()]);
  await state.service.fetchAndMatch("user-a");
  assert.equal((await state.service.fetchAndMatch("user-b")).scraped, 1);
  assert.equal(state.rows.length, 2);
});
