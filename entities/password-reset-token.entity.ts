import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";

import { User } from "./user.entity";

@Entity({ name: "password_reset_tokens" })
export class PasswordResetToken {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @ManyToOne(() => User, (user) => user.resetTokens, { onDelete: "CASCADE" })
  user!: User;

  @Column({ type: "varchar" })
  tokenHash!: string;

  @Column({ type: "timestamp" })
  expiresAt!: Date;

  @Column({ type: "boolean", default: false })
  used!: boolean;

  @CreateDateColumn()
  createdAt!: Date;
}
