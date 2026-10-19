import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";

import { JobPreference } from "../entities/job-preference.entity";
import { User } from "../entities/user.entity";
import { searchOptions } from "./search-options";

type PreferenceInput = {
  targetRole?: string;
  targetRoles?: string[];
  locations?: string[];
  skills: string[];
  location?: string;
  jobType?: string;
};

@Injectable()
export class PreferencesService {
  constructor(
    @InjectRepository(JobPreference)
    private readonly preferencesRepository: Repository<JobPreference>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  async save(userId: string, input: PreferenceInput) {
    const targetRoles = searchOptions(input.targetRoles, input.targetRole, "Roles");
    const locations = searchOptions(input.locations, input.location || "Remote", "Locations");
    const user = await this.usersRepository.findOne({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException("User not found");
    }

    const latest = await this.latest(userId);

    return this.preferencesRepository.save({
      ...(latest ?? {}),
      user,
      targetRole: targetRoles.join(", "),
      targetRoles,
      locations,
      skills: input.skills.map((skill) => skill.trim()).filter(Boolean),
      location: locations.join(", "),
      jobType: input.jobType?.trim() || "Full-time",
    });
  }

  latest(userId: string) {
    return this.preferencesRepository.findOne({
      where: { user: { id: userId } },
      order: { updatedAt: "DESC" },
    });
  }
}
