import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { TypeOrmModule } from "@nestjs/typeorm";

import { AuthModule } from "./auth/auth.module";
import { SlackLoginState } from "./entities/slack-login-state.entity";
import { ImagesModule } from "./images/images.module";
import { UserImage } from "./entities/image.entity";
import { JobMatch } from "./entities/job-match.entity";
import { JobPreference } from "./entities/job-preference.entity";
import { Job } from "./entities/job.entity";
import { JobApplication } from "./entities/job-application.entity";
import { JobSearchState } from "./entities/job-search-state.entity";
import { PasswordResetToken } from "./entities/password-reset-token.entity";
import { Resume } from "./entities/resume.entity";
import { User } from "./entities/user.entity";
import { JobsModule } from "./jobs/jobs.module";
import { PreferencesModule } from "./preferences/preferences.module";
import { ResumesModule } from "./resumes/resumes.module";

@Module({
  imports: [
    ConfigModule.forRoot({ envFilePath: [".env", "backend/.env"], isGlobal: true }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: "postgres",
        url: configService.getOrThrow<string>("DATABASE_URL"),
        entities: [User, UserImage, PasswordResetToken, Resume, JobPreference, Job, JobApplication, JobMatch, JobSearchState, SlackLoginState],
        synchronize: true,
        ssl: { rejectUnauthorized: false },
      }),
    }),
    AuthModule,
    ImagesModule,
    ResumesModule,
    PreferencesModule,
    JobsModule,
  ],
})
export class AppModule {}
