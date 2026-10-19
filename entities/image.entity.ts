import { Column, CreateDateColumn, Entity, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { User } from "./user.entity";

@Entity({ name: "user_images" })
export class UserImage {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @ManyToOne(() => User, { onDelete: "CASCADE" }) user!: User;
  @Column({ type: "varchar" }) name!: string;
  @Column({ type: "varchar" }) url!: string;
  @Column({ type: "varchar" }) publicId!: string;
  @Column({ type: "integer" }) size!: number;
  @CreateDateColumn() createdAt!: Date;
}
