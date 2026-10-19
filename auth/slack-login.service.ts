import { BadRequestException, ConflictException, Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { createHash, createPublicKey, randomBytes } from "node:crypto";
import { decode, verify, type JwtPayload } from "jsonwebtoken";
import { hash } from "bcryptjs";
import axios from "axios";
import { User } from "../entities/user.entity";
import { SlackLoginState } from "../entities/slack-login-state.entity";
import { AuthService } from "./auth.service";

@Injectable()
export class SlackLoginService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(SlackLoginState) private readonly states: Repository<SlackLoginState>,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  private settings() {
    const clientId = this.config.get<string>("SLACK_CLIENT_ID");
    const clientSecret = this.config.get<string>("SLACK_CLIENT_SECRET");
    const redirectUri = this.config.get<string>("SLACK_LOGIN_REDIRECT_URI");
    const teamId = this.config.get<string>("SLACK_TEAM_ID");
    if (!clientId || !clientSecret || !redirectUri || !teamId) {
      throw new ServiceUnavailableException("Slack sign-in is not configured. Ask the application owner to configure the workspace and OAuth credentials.");
    }
    return { clientId, clientSecret, redirectUri, teamId };
  }

  async start(linkUserId: string | null = null) {
    const config = this.settings();
    const state = randomBytes(32).toString("hex");
    const digest = createHash("sha256").update(state).digest("hex");
    await this.states.query('DELETE FROM slack_login_states WHERE "expiresAt" < NOW()');
    await this.states.save({ hash: digest, expiresAt: new Date(Date.now() + 600000), linkUserId });
    const url = new URL("https://slack.com/openid/connect/authorize");
    Object.entries({ response_type: "code", scope: "openid profile email", client_id: config.clientId,
      redirect_uri: config.redirectUri, team: config.teamId, state, nonce: digest,
    }).forEach(([key, value]) => url.searchParams.set(key, value));
    return { url: url.toString(), state };
  }

  async complete(code: unknown, state: unknown, currentUserId?: string) {
    if (typeof code !== "string" || !code || code.length > 4096 || typeof state !== "string" || !/^[a-f0-9]{64}$/.test(state)) {
      throw new BadRequestException("Invalid Slack sign-in callback.");
    }
    const config = this.settings();
    const digest = createHash("sha256").update(state).digest("hex");
    // Delete and return atomically: expired, replayed, or other-account states cannot exchange a code.
    const result = await this.states.createQueryBuilder().delete()
      .where('hash = :hash AND "expiresAt" > :now AND ("linkUserId" IS NULL OR "linkUserId" = :userId)',
        { hash: digest, now: new Date(), userId: currentUserId ?? null })
      .returning("*").execute();
    const attempt = (result.raw as SlackLoginState[])[0];
    if (!attempt) throw new BadRequestException("Slack sign-in expired or belongs to another account. Please try again.");
    let identity: JwtPayload;
    try {
      const { data } = await axios.post("https://slack.com/api/openid.connect.token", new URLSearchParams({
        code, client_id: config.clientId, client_secret: config.clientSecret,
        redirect_uri: config.redirectUri, grant_type: "authorization_code",
      }).toString(), { timeout: 15000, headers: { "Content-Type": "application/x-www-form-urlencoded" } });
      if (!data.ok || typeof data.id_token !== "string") throw new Error();
      const token = decode(data.id_token, { complete: true });
      if (!token || token.header.alg !== "RS256" || !token.header.kid) throw new Error();
      const { data: jwks } = await axios.get("https://slack.com/openid/connect/keys", { timeout: 15000 });
      const jwk = jwks.keys?.find((key: { kid: string; kty: string }) => key.kid === token.header.kid && key.kty === "RSA");
      if (!jwk) throw new Error();
      const key = createPublicKey({ key: jwk, format: "jwk" }).export({ type: "spki", format: "pem" });
      const claims = verify(data.id_token, key, { algorithms: ["RS256"], issuer: "https://slack.com", audience: config.clientId });
      if (typeof claims === "string" || !claims.exp || claims.nonce !== digest || claims["https://slack.com/team_id"] !== config.teamId) throw new Error();
      identity = claims;
    } catch {
      throw new BadRequestException("Slack sign-in failed. Use an account in the configured workspace and try again.");
    }
    const slackUserId = identity["https://slack.com/user_id"];
    const email = typeof identity.email === "string" ? identity.email.trim().toLowerCase() : "";
    if (typeof slackUserId !== "string" || !/^[UW][A-Z0-9]+$/.test(slackUserId) || identity.sub !== slackUserId || identity.email_verified !== true || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 180) {
      throw new BadRequestException("Slack must provide a verified email address and member identity.");
    }
    let user = await this.users.findOne({ where: { slackTeamId: config.teamId, slackUserId } });
    if (attempt.linkUserId) {
      if (user && user.id !== attempt.linkUserId) throw new ConflictException("This Slack member is already linked to another account.");
      user = await this.users.findOne({ where: { id: attempt.linkUserId } });
      if (!user) throw new BadRequestException("Account no longer exists.");
    } else if (!user) {
      // Migrate only an unlinked account with this workspace's verified email.
      // Never replace a different Slack identity already attached to that account.
      const existing = await this.users.findOne({ where: { email } });
      if (existing?.slackUserId || existing?.slackTeamId) throw new ConflictException("This email belongs to a different Slack identity.");
      user = existing ?? this.users.create({ email, name: String(identity.name || email.split("@")[0]).slice(0, 120),
        passwordHash: await hash(randomBytes(48).toString("hex"), 12) });
    }
    user.slackTeamId = config.teamId;
    user.slackUserId = slackUserId;
    try { user = await this.users.save(user); }
    catch (error) {
      if ((error as { code?: string }).code === "23505") throw new ConflictException("This email or Slack member is already registered. Please sign in again.");
      throw error;
    }
    return this.auth.authResponse(user);
  }
}
