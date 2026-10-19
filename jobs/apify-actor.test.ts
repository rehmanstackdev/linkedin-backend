import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import axios from "axios";
import { JobsService } from "./jobs.service";
import { JobPreference } from "../entities/job-preference.entity";
import { Job } from "../entities/job.entity";

function setup(extra: Record<string, string> = {}) {
  const settings = { APIFY_TOKEN: "test-token", APIFY_JOB_ACTOR_ID: "curious_coder/linkedin-jobs-search-scraper", APIFY_LINKEDIN_COOKIES: '[{"name":"li_at","value":"test-cookie"}]', APIFY_LINKEDIN_USER_AGENT: "test-agent", ...extra };
  const service = new JobsService({ create: (value: unknown) => value } as never, {} as never, {} as never, {} as never, { get: (key: keyof typeof settings) => settings[key] } as never);
  return service as unknown as { fetchFromApify: (profile: JobPreference) => Promise<Job[]> };
}
const profile = { targetRole: "Developer", location: "Remote", skills: ["React"] } as JobPreference;
test("advanced actor receives filters and maps structured results", async () => {
  const original = axios.post;
  const requests: { url: string; input: Record<string, unknown> }[] = [];
  axios.post = (async (url: string, input: Record<string, unknown>) => {
    requests.push({ url, input });
    return { data: [{ id: "job-1", title: "Developer", companyName: "Test Co", location: { defaultLocalizedName: "Lahore, Pakistan" }, link: "https://www.linkedin.com/jobs/view/1", descriptionText: "React role", postedAtTimestamp: 1792036800000 }] };
  }) as typeof axios.post;
  try {
    const jobs = await setup().fetchFromApify(profile);
    assert.ok(requests[0].url.includes("curious_coder~linkedin-jobs-search-scraper"));
    assert.ok(!requests[0].url.includes("test-token"));
    assert.equal(requests[0].input.count, 20);
    assert.deepEqual(requests[0].input.filters, { keywords: "Developer React", workplaceType: ["2"], sortBy: "DD", timePostedRange: "r86400" });
    assert.equal(jobs[0].location, "Lahore, Pakistan");
    assert.equal(jobs[0].description, "React role");
    assert.equal(jobs[0].url, "https://www.linkedin.com/jobs/view/1");
    assert.ok(jobs[0].postedAt instanceof Date);
  } finally { axios.post = original; }
});
test("missing LinkedIn session settings produce a clear error", async () => {
  await assert.rejects(setup({ APIFY_LINKEDIN_COOKIES: "[]" }).fetchFromApify(profile), /APIFY_LINKEDIN_COOKIES/);
  await assert.rejects(setup({ APIFY_LINKEDIN_USER_AGENT: "" }).fetchFromApify(profile), /APIFY_LINKEDIN_USER_AGENT/);
});

test("public actor searches without LinkedIn cookies or a user agent", async () => {
  const original = axios.post;
  let requested = false;
  axios.post = (async (url: string, input: Record<string, unknown>) => {
    requested = true;
    assert.ok(url.includes("curious_coder~linkedin-jobs-scraper"));
    const urls = input.urls as string[];
    assert.equal(urls.length, 4);
    const searches = urls.map(url => new URL(url));
    assert.deepEqual(searches.map(url => [url.searchParams.get("keywords"), url.searchParams.get("location")]), [["Full Stack Engineer React", "Pakistan"], ["Full Stack Engineer React", "Remote"], ["React Developer React", "Pakistan"], ["React Developer React", "Remote"]]);
    assert.ok(searches.every(url => url.searchParams.get("f_TPR") === "r7200"));
    assert.equal(input.limitPerSource, 20);
    assert.equal(input.datePosted, undefined);
    assert.equal(input.cookies, undefined);
    assert.equal(input.userAgent, undefined);
    return { data: [{ id: "public-1", title: "Developer", companyLogo: "https://media.licdn.com/company-logo.png", location: "Remote", descriptionText: "React", link: "https://www.linkedin.com/jobs/view/1" }] };
  }) as typeof axios.post;
  try {
    const jobs = await setup({ APIFY_JOB_ACTOR_ID: "curious_coder/linkedin-jobs-scraper", APIFY_LINKEDIN_COOKIES: "", APIFY_LINKEDIN_USER_AGENT: "" }).fetchFromApify({ ...profile, targetRoles: ["Full Stack Engineer", "React Developer"], locations: ["Pakistan", "Remote"] } as JobPreference);
    assert.ok(requested);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].location, "Remote");
    assert.equal(jobs[0].companyLogo, "https://media.licdn.com/company-logo.png");
  } finally { axios.post = original; }
});
