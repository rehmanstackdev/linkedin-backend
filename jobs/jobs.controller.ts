import { Inject } from "@nestjs/common";
import {
  Controller,
  Body,
  Put,
  Delete,
  Param,
  ParseUUIDPipe,
  Get,
  Header,
  Post,
  Req,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";

import type { AuthenticatedRequest } from "../common/authenticated-request";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { JobsService } from "./jobs.service";

@UseGuards(JwtAuthGuard)
@Controller("jobs")
export class JobsController {
  constructor(@Inject(JobsService) private readonly jobsService: JobsService) {}

  @Put("saved/:id/status")
  updateStatus(@Req() request: AuthenticatedRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() body: { status?: unknown }) {
    return this.jobsService.updateApplicationStatus(request.user.id, id, body?.status);
  }

  @Delete("saved/:id")
  deleteSaved(@Req() request: AuthenticatedRequest, @Param("id", new ParseUUIDPipe()) id: string) {
    return this.jobsService.deleteSavedJob(request.user.id, id);
  }

  @Get("saved")
  saved(@Req() request: AuthenticatedRequest, @Query("period") period?: string, @Query("page") page?: string, @Query("search") search?: string, @Query("company") company?: string, @Query("location") location?: string, @Query("sort") sort?: string, @Query("direction") direction?: string, @Query("size") size?: string) {
    return this.jobsService.savedJobs(request.user.id, period, Number(page || 1), search, { company, location, sort, direction, size: Number(size || 20) });
  }

  @Post("scrape")
  scrape(@Req() request: AuthenticatedRequest) {
    return this.jobsService.fetchAndMatch(request.user.id);
  }

  @Post("cron/run")
  runCronNow(@Req() request: AuthenticatedRequest) {
    return this.jobsService.fetchAndMatch(request.user.id);
  }

  @Get("matches")
  matches(@Req() request: AuthenticatedRequest) {
    return this.jobsService.matches(request.user.id);
  }

  @Get("matches.xlsx")
  @Header(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  )
  async excel(@Req() request: AuthenticatedRequest, @Res() response: Response) {
    const buffer = await this.jobsService.excel(request.user.id);
    response.setHeader(
      "Content-Disposition",
      'attachment; filename="job-matches.xlsx"',
    );
    response.send(buffer);
  }

  @Post("matches.xlsx/append")
  appendExcel(@Req() request: AuthenticatedRequest) {
    return this.jobsService.appendExcel(request.user.id);
  }

  @Post("notify-slack")
  notifySlack(@Req() request: AuthenticatedRequest) {
    return this.jobsService.notifySlack(request.user.id);
  }

  @Get("slack/settings")
  slackSettings(@Req() request: AuthenticatedRequest) {
    return this.jobsService.slackSettings(request.user.id);
  }

  @Post("slack/oauth/start")
  startSlackOAuth(@Req() request: AuthenticatedRequest) {
    return this.jobsService.startSlackOAuth(request.user.id);
  }

  @Post("slack/oauth/complete")
  completeSlackOAuth(@Req() request: AuthenticatedRequest, @Body() body: { code?: unknown; state?: unknown }) {
    return this.jobsService.completeSlackOAuth(request.user.id, body?.code, body?.state);
  }

  @Put("slack/settings")
  saveSlack(@Req() request: AuthenticatedRequest, @Body() body: { webhookUrl?: unknown }) {
    return this.jobsService.saveSlackSettings(request.user.id, body?.webhookUrl);
  }

  @Delete("slack/settings")
  disconnectSlack(@Req() request: AuthenticatedRequest) {
    return this.jobsService.disconnectSlack(request.user.id);
  }
}
