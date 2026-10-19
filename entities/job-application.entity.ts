import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn, UpdateDateColumn } from "typeorm";
import { Job } from "./job.entity";
import { User } from "./user.entity";

export const applicationStatuses = ["saved", "applied", "follow_up", "interviewing", "offer", "rejected", "withdrawn"] as const;
export type ApplicationStatus = typeof applicationStatuses[number];

@Entity({ name: "job_applications" })
export class JobApplication {
  @PrimaryColumn("uuid") userId!: string;
  @PrimaryColumn("uuid") jobId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "userId" }) user!: User;

  @ManyToOne(() => Job, { onDelete: "CASCADE" })
  @JoinColumn({ name: "jobId" }) job!: Job;

  @Column({ type: "varchar", default: "saved" }) status!: ApplicationStatus;
  @UpdateDateColumn() updatedAt!: Date;
}
