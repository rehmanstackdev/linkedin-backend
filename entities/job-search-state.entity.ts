import { Column, Entity, PrimaryColumn } from "typeorm";

@Entity({ name: "job_search_states" })
export class JobSearchState {
  @PrimaryColumn({ type: "uuid" }) userId!: string;
  @Column({ type: "timestamptz" }) nextFetchAt!: Date;
}
