import { Inject } from "@nestjs/common";
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { verify } from "jsonwebtoken";

import { AuthenticatedRequest } from "./authenticated-request";

type JwtPayload = {
  sub: string;
  email: string;
  provider: string;
  slackTeamId: string;
  slackUserId: string;
};

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(@Inject(ConfigService) private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext) {
    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;

    if (!header?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing bearer token");
    }

    try {
      const secret = this.configService.getOrThrow<string>("JWT_SECRET");
      const payload = verify(header.slice(7), secret, { algorithms: ["HS256"] }) as JwtPayload;
      if (payload.provider !== "slack" || !payload.sub || !payload.email || !payload.slackUserId || !payload.slackTeamId || payload.slackTeamId !== this.configService.get<string>("SLACK_TEAM_ID")) {
        throw new UnauthorizedException("Sign in with Slack to access your workspace.");
      }
      request.user = { id: payload.sub, email: payload.email };
      return true;
    } catch {
      throw new UnauthorizedException("Invalid or expired token");
    }
  }
}
