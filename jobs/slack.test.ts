import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { IncomingWebhook } from "@slack/webhook";
import axios from "axios";
import { JobsService } from "./jobs.service";
import { encryptWebhook, decryptWebhook } from "./slack-secret";

const secret = "test-only-encryption-key";
const url = "https://hooks.slack.com/services/TUSER/BCHANNEL/testsecret";

test("webhook encryption authenticates ciphertext and hides the URL", () => {
  const value = encryptWebhook(url, secret);
  assert.ok(!value.includes(url));
  assert.equal(decryptWebhook(value, secret), url);
  assert.throws(() => decryptWebhook(value, "wrong-key"));
});

test("Slack settings only update the current account and never return the URL", async () => {
  const updates: unknown[] = [];
  const users = { update: async (...args: unknown[]) => { updates.push(args); return { affected: 1 }; } };
  const service = new JobsService({} as never, {} as never, {} as never, users as never, { get: () => secret } as never);
  assert.deepEqual(await service.saveSlackSettings("user-a", url), { connected: true, message: "Your Slack channel is connected." });
  const [id, data] = updates[0] as [string, { slackWebhookEncrypted: string }];
  assert.equal(id, "user-a");
  assert.equal(decryptWebhook(data.slackWebhookEncrypted, secret), url);
  await assert.rejects(service.saveSlackSettings("user-a", "https://example.com/services/a/b/c"), /valid Slack/);
  await service.disconnectSlack("user-a");
  assert.deepEqual(updates[1], ["user-a", { slackWebhookEncrypted: null, slackOAuthStateHash: null, slackOAuthExpiresAt: null }]);
});

test("notifications use the user's webhook and only mark delivered matches", async () => {
  const delivered: unknown[] = [];
  const saved: string[] = [];
  const matches = Array.from({ length: 11 }, (_, index) => ({ id: String(index), score: 100, job: { title: "Developer", url: "https://example.com/job" } }));
  const users = { findOne: async (options: { where: { id: string } }) => {
    assert.equal(options.where.id, "user-a");
    return { slackWebhookEncrypted: encryptWebhook(url, secret) };
  } };
  const repository = { find: async (options: { where: { user: { id: string } } }) => {
    assert.equal(options.where.user.id, "user-a"); return matches;
  }, save: async (match: { id: string }) => { saved.push(match.id); } };
  const service = new JobsService({} as never, repository as never, {} as never, users as never, { get: () => secret } as never);
  const original = IncomingWebhook.prototype.send;
  IncomingWebhook.prototype.send = async function (message) {
    assert.equal((this as unknown as { url: string }).url, url); delivered.push(message); return { text: "ok" };
  };
  try {
    assert.equal((await service.notifySlack("user-a")).sent, 10);
    assert.equal(saved.length, 10);
    assert.ok(JSON.stringify(delivered).includes("https://example.com/job|View job"));
    saved.length = 0;
    IncomingWebhook.prototype.send = async () => { throw new Error("secret webhook details"); };
    await assert.rejects(service.notifySlack("user-a"), /Slack could not receive/);
    assert.equal(saved.length, 0);
  } finally { IncomingWebhook.prototype.send = original; }
});

test("users without a connection never fall back to the shared webhook", async () => {
  const service = new JobsService({} as never, {} as never, {} as never, { findOne: async () => ({}) } as never, { get: () => url } as never);
  assert.equal((await service.notifySlack("user-b")).sent, 0);
});

test("linked members receive personal bot DMs and Slack rejections leave matches pending", async () => {
  const saved: unknown[] = [];
  const calls: string[] = [];
  const config: Record<string, string> = { SLACK_TEAM_ID: "T123", SLACK_BOT_TOKEN: "xoxb-test" };
  const matches = [{ id: "match", score: 85, job: { title: "Developer", url: "https://example.com/job" } }];
  const service = new JobsService({} as never,
    { find: async () => matches, save: async (value: unknown) => saved.push(value) } as never, {} as never,
    { findOne: async () => ({ slackTeamId: "T123", slackUserId: "U123" }) } as never,
    { get: (key: string) => config[key] } as never);
  const original = axios.post;
  let rejectMessage = false;
  let wrongWorkspace = false;
  axios.post = (async (url: string, body: any, options: any) => {
    calls.push(url);
    assert.equal(options.headers.Authorization, "Bearer xoxb-test");
    if (url.endsWith("auth.test")) return { data: { ok: true, team_id: wrongWorkspace ? "TOTHER" : "T123" } };
    if (url.endsWith("conversations.open")) { assert.deepEqual(body, { users: "U123" }); return { data: { ok: true, channel: { id: "D123" } } }; }
    assert.equal(body.channel, "D123");
    return { data: { ok: !rejectMessage } };
  }) as typeof axios.post;
  try {
    assert.equal((await service.notifySlack("user")).sent, 1);
    assert.equal(saved.length, 1);
    saved.length = 0;
    rejectMessage = true;
    await assert.rejects(service.notifySlack("user"), /Slack could not receive/);
    assert.equal(saved.length, 0);
    calls.length = 0;
    wrongWorkspace = true;
    await assert.rejects(service.notifySlack("user"), /Slack could not receive/);
    assert.equal(calls.length, 1);
    assert.equal(saved.length, 0);
  } finally { axios.post = original; }
});

test("OAuth start requests only channel webhook scope and stores a hashed expiring state", async () => {
  let saved: any;
  const config: Record<string, string> = { SLACK_CLIENT_ID: "client", SLACK_CLIENT_SECRET: "secret", SLACK_REDIRECT_URI: "https://example.com/dashboard/slack", JWT_SECRET: secret };
  const users = { update: async (id: string, data: unknown) => { assert.equal(id, "user-a"); saved = data; } };
  const service = new JobsService({} as never, {} as never, {} as never, users as never, { get: (key: string) => config[key] } as never);
  const result = await service.startSlackOAuth("user-a");
  const authorize = new URL(result.url);
  assert.equal(authorize.origin, "https://slack.com");
  assert.equal(authorize.searchParams.get("scope"), "incoming-webhook");
  assert.equal(authorize.searchParams.get("state"), result.state);
  assert.notEqual(saved.slackOAuthStateHash, result.state);
  assert.ok(saved.slackOAuthExpiresAt > new Date());
});

test("expired, replayed and other-account OAuth states cannot exchange a code", async () => {
  let conditions: any;
  const builder = { update: () => builder, set: () => builder, where: (_sql: string, params: unknown) => { conditions = params; return builder; }, execute: async () => ({ affected: 0 }) };
  const service = new JobsService({} as never, {} as never, {} as never, { createQueryBuilder: () => builder } as never, { get: () => "configured" } as never);
  await assert.rejects(service.completeSlackOAuth("other-user", "code", "a".repeat(64)), /expired or belongs to another account/);
  assert.equal(conditions.userId, "other-user");
  assert.ok(conditions.now instanceof Date);
});

test("OAuth completion saves the authorized webhook for the signed-in account", async () => {
  let updated: any;
  const builder = { update: () => builder, set: () => builder, where: () => builder, execute: async () => ({ affected: 1 }) };
  const users = { createQueryBuilder: () => builder, update: async (id: string, value: unknown) => { assert.equal(id, "user-a"); updated = value; return { affected: 1 }; } };
  const service = new JobsService({} as never, {} as never, {} as never, users as never, { get: () => secret } as never);
  const original = axios.post;
  axios.post = (async (endpoint: string, body: string) => {
    assert.equal(endpoint, "https://slack.com/api/oauth.v2.access");
    assert.equal(new URLSearchParams(body).get("code"), "temporary-code");
    return { data: { ok: true, incoming_webhook: { url } } };
  }) as typeof axios.post;
  try {
    const result = await service.completeSlackOAuth("user-a", "temporary-code", "b".repeat(64));
    assert.equal(result.connected, true);
    assert.equal(decryptWebhook(updated.slackWebhookEncrypted, secret), url);
    axios.post = (async () => { throw new Error("contains credentials"); }) as typeof axios.post;
    await assert.rejects(service.completeSlackOAuth("user-a", "temporary-code", "b".repeat(64)), /Slack authorization failed/);
  } finally { axios.post = original; }
});
