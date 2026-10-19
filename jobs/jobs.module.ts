import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { JobMatch } from "../entities/job-match.entity";
import { JobPreference } from "../entities/job-preference.entity";
import { Job } from "../entities/job.entity";
import { User } from "../entities/user.entity";
import { JobsController } from "./jobs.controller";
import { JobsService } from "./jobs.service";

@Module({
  imports: [TypeOrmModule.forFeature([Job, JobMatch, JobPreference, User])],
  controllers: [JobsController],
  providers: [JobsService],
})
export class JobsModule {}
