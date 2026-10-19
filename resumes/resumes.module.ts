import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { Resume } from "../entities/resume.entity";
import { User } from "../entities/user.entity";
import { ResumesController } from "./resumes.controller";
import { ResumesService } from "./resumes.service";
import { PreferencesModule } from "../preferences/preferences.module";

@Module({
  imports: [TypeOrmModule.forFeature([Resume, User]), PreferencesModule],
  controllers: [ResumesController],
  providers: [ResumesService],
})
export class ResumesModule {}
