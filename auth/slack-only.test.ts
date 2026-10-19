import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { sign } from "jsonwebtoken";
import { PATH_METADATA } from "@nestjs/common/constants";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { JobsController } from "../jobs/jobs.controller";

const config = { get: (key: string) => key === "SLACK_TEAM_ID" ? "T123" : "test-secret", getOrThrow: () => "test-secret" };
function request(token?: string) {
  const req = { headers: { authorization: token ? `Bearer ${token}` : undefined }, user: undefined as unknown };
  const context = { switchToHttp: () => ({ getRequest: () => req }) };
  return { req, context };
}

test("password signup, login, recovery and account-link routes are not exposed", () => {
  const paths = Object.getOwnPropertyNames(AuthController.prototype)
    .map(name => Reflect.getMetadata(PATH_METADATA, (AuthController.prototype as any)[name]));
  for (const path of ["signup", "login", "password/request-reset", "password/reset", "slack/link/start", "slack/link/complete"]) assert.ok(!paths.includes(path));
});

test("protected endpoints reject old password sessions and other workspaces", () => {
  const guard = new JwtAuthGuard(config as never);
  for (const claims of [{ sub: "user-a", email: "a@example.com" }, { sub: "user-a", email: "a@example.com", provider: "slack", slackTeamId: "TOTHER", slackUserId: "U123" }]) {
    const { context } = request(sign(claims, "test-secret"));
    assert.throws(() => guard.canActivate(context as never), /Invalid or expired/);
  }
  assert.throws(() => guard.canActivate(request().context as never), /Missing bearer/);
});

test("Slack sessions use the signed-in account identity", () => {
  const service = new AuthService({} as never, config as never);
  const result = service.authResponse({ id: "user-a", email: "a@example.com", name: "A", slackTeamId: "T123", slackUserId: "U123" } as never);
  const { req, context } = request(result.token);
  assert.equal(new JwtAuthGuard(config as never).canActivate(context as never), true);
  assert.deepEqual(req.user, { id: "user-a", email: "a@example.com" });
  assert.throws(() => service.authResponse({ id: "unlinked-user" } as never), /Sign in with Slack/);
});

test("manual cron request only searches for the signed-in account", async () => {
  const controller = new JobsController({ fetchAndMatch: async (id: string) => { assert.equal(id, "user-a"); return { matched: 1 }; } } as never);
  assert.deepEqual(await controller.runCronNow({ user: { id: "user-a" }, body: { userId: "user-b" } } as never), { matched: 1 });
});
