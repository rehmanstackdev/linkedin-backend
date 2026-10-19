import { Body, Controller, Get, Inject, Post, Req, UseGuards } from "@nestjs/common";
import type { AuthenticatedRequest } from "../common/authenticated-request";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { AuthService } from "./auth.service";
import { SlackLoginService } from "./slack-login.service";

@Controller("auth")
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService,
    @Inject(SlackLoginService) private readonly slackLogin: SlackLoginService) {}

  @Post("slack/start")
  startSlack() { return this.slackLogin.start(); }

  @Post("slack/complete")
  completeSlack(@Body() body: { code?: unknown; state?: unknown }) {
    return this.slackLogin.complete(body?.code, body?.state);
  }

  @UseGuards(JwtAuthGuard)
  @Get("me")
  me(@Req() request: AuthenticatedRequest) { return this.authService.me(request.user.id); }

  // Email signup, password login and password recovery are disabled.
  // Slack is the only way to create or authenticate an account.
}
