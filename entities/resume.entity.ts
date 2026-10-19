import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";

import { User } from "./user.entity";

@Entity({ name: "resumes" })
export class Resume {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @ManyToOne(() => User, (user) => user.resumes, { onDelete: "CASCADE" })
  user!: User;

  @Column({ type: "varchar" })
  originalName!: string;

  @Column({ type: "varchar" })
  storedName!: string;

  @Column({ type: "varchar" })
  path!: string;

  @Column({ type: "varchar", nullable: true })
  cloudinaryPublicId?: string;

  @Column({ type: "varchar", nullable: true })
  secureUrl?: string;

  @Column({ type: "varchar" })
  mimeType!: string;

  @Column({ type: "int" })
  size!: number;

  @Column({ type: "simple-json", nullable: true })
  keywords!: string[] | null;

  @Column({ type: "varchar", nullable: true })
  suggestedRole!: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}
