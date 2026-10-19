import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { User } from "../entities/user.entity";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { SlackLoginState } from "../entities/slack-login-state.entity";
import { SlackLoginService } from "./slack-login.service";

@Module({
  imports: [TypeOrmModule.forFeature([User, SlackLoginState])],
  controllers: [AuthController],
  providers: [AuthService, SlackLoginService, JwtAuthGuard],
  exports: [JwtAuthGuard],
})
export class AuthModule {}
