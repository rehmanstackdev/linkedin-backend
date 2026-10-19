import { Inject } from "@nestjs/common";
import { Body, Controller, Get, Post, Req, UseGuards } from "@nestjs/common";

import type { AuthenticatedRequest } from "../common/authenticated-request";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { PreferencesService } from "./preferences.service";

@UseGuards(JwtAuthGuard)
@Controller("preferences")
export class PreferencesController {
  constructor(@Inject(PreferencesService) private readonly preferencesService: PreferencesService) {}

  @Post()
  save(
    @Req() request: AuthenticatedRequest,
    @Body()
    body: {
      targetRole: string;
      targetRoles?: string[];
      locations?: string[];
      skills: string[];
      location?: string;
      jobType?: string;
    },
  ) {
    return this.preferencesService.save(request.user.id, body);
  }

  @Get()
  latest(@Req() request: AuthenticatedRequest) {
    return this.preferencesService.latest(request.user.id);
  }
}
