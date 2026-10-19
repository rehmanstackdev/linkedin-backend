import { Column, Entity, PrimaryColumn } from "typeorm";

@Entity({ name: "slack_login_states" })
export class SlackLoginState {
  @PrimaryColumn({ type: "varchar" })
  hash!: string;

  @Column({ type: "timestamp" })
  expiresAt!: Date;

  @Column({ type: "uuid", nullable: true })
  linkUserId!: string | null;
}
