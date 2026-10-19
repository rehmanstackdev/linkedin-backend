import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";

import { Job } from "./job.entity";
import { User } from "./user.entity";

@Entity({ name: "job_matches" })
export class JobMatch {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @ManyToOne(() => User, (user) => user.matches, { onDelete: "CASCADE" })
  user!: User;

  @ManyToOne(() => Job, (job) => job.matches, { onDelete: "CASCADE" })
  job!: Job;

  @Column({ type: "int" })
  score!: number;

  @Column("simple-array")
  matchedSkills!: string[];

  @Column({ type: "boolean", default: false })
  slackNotified!: boolean;

  @CreateDateColumn()
  createdAt!: Date;
}
