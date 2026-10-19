import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";

import { JobMatch } from "./job-match.entity";
import { User } from "./user.entity";

@Entity({ name: "jobs" })
export class Job {
  @ManyToOne(() => User, { nullable: true, onDelete: "CASCADE" })
  user?: User;

  @Column({ type: "timestamptz", nullable: true })
  postedAt!: Date | null;
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", nullable: true })
  externalId?: string;

  @Column({ type: "varchar" })
  title!: string;

  @Column({ type: "varchar", nullable: true })
  company?: string;

  @Column({ type: "text", nullable: true })
  companyLogo?: string;

  @Column({ type: "varchar", nullable: true })
  location?: string;

  @Column({ type: "varchar", nullable: true })
  url?: string;

  @Column({ type: "text", nullable: true })
  description?: string;

  @Column({ type: "varchar", default: "apify" })
  source!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @OneToMany(() => JobMatch, (match) => match.job)
  matches!: JobMatch[];
}
