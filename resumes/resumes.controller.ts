import { Inject } from "@nestjs/common";
import {
  Controller,
  Get,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request } from "express";

import type { AuthenticatedRequest } from "../common/authenticated-request";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { ResumesService } from "./resumes.service";

@UseGuards(JwtAuthGuard)
@Controller("resumes")
export class ResumesController {
  constructor(@Inject(ResumesService) private readonly resumesService: ResumesService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor("resume", {
      fileFilter: (_request: Request, file, callback) => {
        const allowed = [
          "application/pdf",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ];
        callback(null, allowed.includes(file.mimetype));
      },
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  upload(
    @Req() request: AuthenticatedRequest,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.resumesService.upload(request.user.id, file);
  }

  @Get()
  list(@Req() request: AuthenticatedRequest) {
    return this.resumesService.list(request.user.id);
  }
}
