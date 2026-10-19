import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash, generateKeyPairSync } from "node:crypto";
import { sign } from "jsonwebtoken";
import axios from "axios";
import { SlackLoginService } from "./slack-login.service";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const config: Record<string, string> = { SLACK_CLIENT_ID: "client", SLACK_CLIENT_SECRET: "secret",
  SLACK_LOGIN_REDIRECT_URI: "https://example.com/auth/slack", SLACK_TEAM_ID: "T123" };

function fixture(existing: Record<string, unknown>[] = []) {
  const attempts = new Map<string, any>();
  const records = [...existing];
  let params: any;
  const builder: any = {
    delete: () => builder,
    where: (_sql: string, values: unknown) => { params = values; return builder; },
    returning: () => builder,
    execute: async () => {
      const row = attempts.get(params.hash);
      if (!row || row.expiresAt <= params.now || (row.linkUserId && row.linkUserId !== params.userId)) return { raw: [] };
      attempts.delete(params.hash);
      return { raw: [row] };
    },
  };
  const users = {
    findOne: async ({ where }: { where: Record<string, unknown> }) => records.find(row => Object.entries(where).every(([key, value]) => row[key] === value)) ?? null,
    create: (value: unknown) => value,
    save: async (value: Record<string, unknown>) => {
      if (!value.id) { value.id = "new-user"; records.push(value); }
      return value;
    },
  };
  const states = { query: async () => [], save: async (row: any) => { attempts.set(row.hash, row); }, createQueryBuilder: () => builder };
  const service = new SlackLoginService(users as never, states as never, { get: (key: string) => config[key] } as never,
    { authResponse: (user: unknown) => ({ token: "app-token", user }) } as never);
  return { service, attempts, records };
}

async function withSlack(state: string, claims: Record<string, unknown>, run: () => Promise<void>, invalidSignature = false) {
  const payload = { iss: "https://slack.com", aud: "client", exp: Math.floor(Date.now() / 1000) + 300,
    sub: "U123", nonce: createHash("sha256").update(state).digest("hex"),
    "https://slack.com/user_id": "U123", "https://slack.com/team_id": "T123",
    email: "person@example.com", email_verified: true, name: "Test Person", ...claims };
  const idToken = sign(payload, privateKey, { algorithm: "RS256", keyid: "key" });
  const originalPost = axios.post;
  const originalGet = axios.get;
  axios.post = (async (url: string) => {
    assert.equal(url, "https://slack.com/api/openid.connect.token");
    return { data: { ok: true, id_token: invalidSignature ? idToken.slice(0, -10) + "abcdefghij" : idToken } };
  }) as typeof axios.post;
  axios.get = (async (url: string) => {
    assert.equal(url, "https://slack.com/openid/connect/keys");
    return { data: { keys: [{ ...publicKey.export({ format: "jwk" }), kid: "key" }] } };
  }) as typeof axios.get;
  try { await run(); } finally { axios.post = originalPost; axios.get = originalGet; }
}

test("Slack start uses OpenID scopes and a single-workspace, hashed, expiring state", async () => {
  const { service, attempts } = fixture();
  const result = await service.start();
  const url = new URL(result.url);
  assert.equal(url.pathname, "/openid/connect/authorize");
  assert.equal(url.searchParams.get("scope"), "openid profile email");
  assert.equal(url.searchParams.get("team"), "T123");
  assert.ok(!attempts.has(result.state));
  assert.equal(attempts.get(url.searchParams.get("nonce")!).linkUserId, null);
});

test("verified Slack login creates an account, reuses it, and rejects state replay", async () => {
  const { service, records } = fixture();
  const first = await service.start();
  await withSlack(first.state, {}, async () => {
    const result = await service.complete("code", first.state);
    assert.equal(result.token, "app-token");
    assert.equal(records.length, 1);
    assert.equal(records[0].slackUserId, "U123");
    await assert.rejects(service.complete("code", first.state), /expired/);
  });
  const second = await service.start();
  await withSlack(second.state, {}, async () => {
    await service.complete("code", second.state);
    assert.equal(records.length, 1);
  });
});

for (const [label, claims, invalidSignature] of [
  ["wrong workspace", { "https://slack.com/team_id": "TOTHER" }, false],
  ["wrong nonce", { nonce: "wrong" }, false],
  ["unverified email", { email_verified: false }, false],
  ["invalid signature", {}, true],
  ["expired identity", { exp: 1 }, false],
  ["wrong audience", { aud: "other-client" }, false],
  ["wrong issuer", { iss: "https://other.example" }, false],
] as const) {
  test(`Slack login rejects ${label}`, async () => {
    const { service, records } = fixture();
    const { state } = await service.start();
    await withSlack(state, claims, async () => {
      await assert.rejects(service.complete("code", state));
      assert.equal(records.length, 0);
    }, invalidSignature);
  });
}

test("verified Slack email migrates an unlinked account and preserves its data", async () => {
  const { service, records } = fixture([{ id: "email-user", email: "person@example.com", passwordHash: "unchanged", name: "Existing" }]);
  const login = await service.start();
  await withSlack(login.state, {}, async () => {
    const result = await service.complete("code", login.state);
    assert.equal((result.user as any).id, "email-user");
  });
  const link = await service.start("email-user");
  await assert.rejects(service.complete("code", link.state, "other-user"), /another account/);
  await assert.rejects(service.complete("code", link.state), /another account/);
  await withSlack(link.state, {}, async () => { await service.complete("code", link.state, "email-user"); });
  assert.equal(records.length, 1);
  assert.equal(records[0].passwordHash, "unchanged");
  assert.equal(records[0].slackUserId, "U123");
});

test("expired state and identity already linked to another account are rejected", async () => {
  const { service, attempts } = fixture([{ id: "owner", slackTeamId: "T123", slackUserId: "U123" }, { id: "other" }]);
  const expired = await service.start();
  attempts.values().next().value.expiresAt = new Date(0);
  await assert.rejects(service.complete("code", expired.state), /expired/);
  const link = await service.start("other");
  await withSlack(link.state, {}, async () => {
    await assert.rejects(service.complete("code", link.state, "other"), /already linked/);
  });
});

test("a matching email cannot replace another Slack identity", async () => {
  const { service, records } = fixture([{ id: "owner", email: "person@example.com", slackTeamId: "T123", slackUserId: "UOTHER" }]);
  const { state } = await service.start();
  await withSlack(state, {}, async () => {
    await assert.rejects(service.complete("code", state), /different Slack identity/);
    assert.equal(records[0].slackUserId, "UOTHER");
  });
});
