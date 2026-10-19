import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

import { JobMatch } from "./job-match.entity";
import { JobPreference } from "./job-preference.entity";
import { PasswordResetToken } from "./password-reset-token.entity";
import { Resume } from "./resume.entity";

@Entity({ name: "users" })
@Index(["slackTeamId", "slackUserId"], { unique: true })
export class User {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 120 })
  name!: string;

  @Column({ type: "varchar", unique: true, length: 180 })
  email!: string;

  @Column({ type: "varchar", select: false })
  passwordHash!: string;

  @Column({ type: "varchar", nullable: true })
  slackTeamId!: string | null;

  @Column({ type: "varchar", nullable: true })
  slackUserId!: string | null;

  @Column({ type: "text", nullable: true, select: false })
  slackWebhookEncrypted!: string | null;

  @Column({ type: "varchar", nullable: true, select: false })
  slackOAuthStateHash!: string | null;

  @Column({ type: "timestamp", nullable: true, select: false })
  slackOAuthExpiresAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @OneToMany(() => Resume, (resume) => resume.user)
  resumes!: Resume[];

  @OneToMany(() => JobPreference, (preference) => preference.user)
  preferences!: JobPreference[];

  @OneToMany(() => JobMatch, (match) => match.user)
  matches!: JobMatch[];

  @OneToMany(() => PasswordResetToken, (token) => token.user)
  resetTokens!: PasswordResetToken[];
}
