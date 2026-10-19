import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { sign } from "jsonwebtoken";
import { Repository } from "typeorm";
import { User } from "../entities/user.entity";

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly usersRepository: Repository<User>,
    @Inject(ConfigService) private readonly configService: ConfigService,
  ) {}

  async me(userId: string) {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user?.slackTeamId || !user.slackUserId) throw new UnauthorizedException("Sign in with Slack to access your workspace.");
    return this.publicUser(user);
  }

  authResponse(user: User) {
    const teamId = this.configService.get<string>("SLACK_TEAM_ID");
    if (!user.slackUserId || !teamId || user.slackTeamId !== teamId) throw new UnauthorizedException("Sign in with Slack to access your workspace.");
    const secret = this.configService.getOrThrow<string>("JWT_SECRET");
    return {
      token: sign({ sub: user.id, email: user.email, provider: "slack", slackTeamId: user.slackTeamId, slackUserId: user.slackUserId }, secret, { algorithm: "HS256", expiresIn: "7d" }),
      user: this.publicUser(user),
    };
  }

  private publicUser(user: User) {
    return { id: user.id, name: user.name, email: user.email };
  }
}
