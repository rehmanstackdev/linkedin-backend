import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

import { User } from "./user.entity";

@Entity({ name: "job_preferences" })
export class JobPreference {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @ManyToOne(() => User, (user) => user.preferences, { onDelete: "CASCADE" })
  user!: User;

  @Column({ type: "varchar" })
  targetRole!: string;

  @Column({ type: "simple-json", nullable: true })
  targetRoles!: string[] | null;

  @Column({ type: "simple-json", nullable: true })
  locations!: string[] | null;

  @Column("simple-array")
  skills!: string[];

  @Column({ type: "varchar", default: "Remote" })
  location!: string;

  @Column({ type: "varchar", default: "Full-time" })
  jobType!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
