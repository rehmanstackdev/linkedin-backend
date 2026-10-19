import { Inject } from "@nestjs/common";
import { Injectable, Logger, NotFoundException, ServiceUnavailableException, BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron } from "@nestjs/schedule";
import { IncomingWebhook } from "@slack/webhook";
import axios from "axios";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { readFile, utils, write, writeFile } from "xlsx";
import { InjectRepository } from "@nestjs/typeorm";
import { IsNull, Repository, type FindOptionsWhere } from "typeorm";

import { JobMatch } from "../entities/job-match.entity";
import { JobPreference } from "../entities/job-preference.entity";
import { Job } from "../entities/job.entity";
import { applicationStatuses } from "../entities/job-application.entity";
import { User } from "../entities/user.entity";
import { buildJobQuery } from "../resumes/resume-keywords";
import { searchCombinations } from "../preferences/search-options";
import { matchesSavedLocation, savedLocations } from "./job-location";
import { encryptWebhook, decryptWebhook } from "./slack-secret";

type ApifyJob = {
  id?: string;
  title?: string;
  positionName?: string;
  company?: string;
  companyName?: string;
  companyLogo?: string;
  location?: string | { defaultLocalizedName?: string; abbreviatedLocalizedName?: string };
  url?: string;
  jobUrl?: string;
  description?: string;
  postedAt?: string;
  publishedAt?: string;
  postedDate?: string;
  datePosted?: string;
  postedAtTimestamp?: number;
  descriptionText?: string;
  link?: string;
};

type MatchExportRow = {
  Title: string;
  Company: string;
  Location: string;
  Score: number;
  Skills: string;
  Url: string;
  Source: string;
  ExportedAt: string;
};

type CronRunResult =
  | {
      userId: string;
      ok: true;
      scraped: number;
      matched: number;
    }
  | {
      userId: string;
      ok: false;
      error: string;
    };

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    @InjectRepository(Job)
    private readonly jobsRepository: Repository<Job>,
    @InjectRepository(JobMatch)
    private readonly matchesRepository: Repository<JobMatch>,
    @InjectRepository(JobPreference)
    private readonly preferencesRepository: Repository<JobPreference>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @Inject(ConfigService) private readonly configService: ConfigService,
  ) {}

  async fetchAndMatch(userId: string) {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    const preference = await this.preferencesRepository.findOne({
      where: { user: { id: userId } },
      order: { updatedAt: "DESC" },
    });

    if (!user || !preference) {
      throw new NotFoundException("User preference is required before scraping jobs");
    }
    if (!this.configService.get<string>("APIFY_TOKEN") || !this.configService.get<string>("APIFY_JOB_ACTOR_ID")) {
      throw new ServiceUnavailableException("Job search is not configured. Set APIFY_TOKEN and APIFY_JOB_ACTOR_ID on the backend.");
    }

    // An atomic database claim prevents overlapping manual/cron runs and
    // survives server restarts. Reserve the window before spending credits.
    const claimed: { nextFetchAt: Date }[] = await this.jobsRepository.query(
      `INSERT INTO job_search_states ("userId", "nextFetchAt")
       VALUES ($1, NOW() + INTERVAL '2 hours')
       ON CONFLICT ("userId") DO UPDATE SET "nextFetchAt" = NOW() + INTERVAL '2 hours'
       WHERE job_search_states."nextFetchAt" <= NOW()
       RETURNING "nextFetchAt"`, [userId],
    );
    if (!claimed.length) {
      const [state] = await this.jobsRepository.query('SELECT "nextFetchAt" FROM job_search_states WHERE "userId" = $1', [userId]);
      const matches = await this.matches(userId);
      return { scraped: 0, matched: matches.length, matches, cached: true, nextFetchAt: state.nextFetchAt };
    }

    const allowed = savedLocations(preference);
    const scrapedJobs = (await this.fetchFromApify(preference)).filter(job => matchesSavedLocation(job.location, allowed));
    const savedJobs: Job[] = [];
    // Sequential inserts also catch duplicates within this search. The database
    // search-window claim above prevents overlapping searches for the same user.
    for (const job of scrapedJobs) {
      const identities: FindOptionsWhere<Job>[] = [];
      if (job.externalId) identities.push({ user: { id: userId }, externalId: job.externalId });
      if (job.url) identities.push({ user: { id: userId }, url: job.url });
      if (!identities.length) identities.push({
        user: { id: userId }, externalId: IsNull(), url: IsNull(),
        title: job.title, company: job.company || IsNull(), location: job.location || IsNull(), source: job.source,
      });
      const existing = await this.jobsRepository.findOne({ where: identities });
      if (existing) continue;
      savedJobs.push(await this.jobsRepository.save({ ...job, user }));
    }
    const matches = await Promise.all(
      savedJobs
        .map((job) => this.scoreJob(user, preference, job))
        .filter((match): match is JobMatch => match.score > 0)
        .map(async (match) => {
          const existing = await this.matchesRepository.findOne({ where: { user: { id: userId }, job: { id: match.job.id } } });
          return this.matchesRepository.save({ ...(existing ?? {}), ...match });
        }),
    );

    return {
      scraped: savedJobs.length,
      matched: matches.length,
      matches,
      cached: false,
      nextFetchAt: claimed[0].nextFetchAt,
    };
  }

  @Cron("0 * * * * *", { name: "fetch-jobs-every-two-hours", waitForCompletion: true })
  async fetchJobsForAllPreferencesCron() {
    this.logger.log("Running scheduled job fetch for saved preferences");
    const result = await this.fetchJobsForAllPreferences();
    this.logger.log(
      `Scheduled job fetch complete: ${result.usersProcessed} users, ${result.totalMatched} matches`,
    );
  }

  async fetchJobsForAllPreferences() {
    const preferences = await this.preferencesRepository.find({
      relations: { user: true },
      order: { updatedAt: "DESC" },
    });
    const latestByUser = new Map<string, JobPreference>();

    for (const preference of preferences) {
      if (!latestByUser.has(preference.user.id)) {
        latestByUser.set(preference.user.id, preference);
      }
    }

    const results: CronRunResult[] = [];

    for (const preference of latestByUser.values()) {
      try {
        const [state] = await this.jobsRepository.query('SELECT "nextFetchAt" FROM job_search_states WHERE "userId" = $1 AND "nextFetchAt" > NOW()', [preference.user.id]);
        if (state) continue;
        const result = await this.fetchAndMatch(preference.user.id);
        results.push({
          userId: preference.user.id,
          ok: true,
          scraped: result.scraped,
          matched: result.matched,
        });
      } catch (error) {
        this.logger.error(
          `Scheduled job fetch failed for user ${preference.user.id}`,
          error instanceof Error ? error.stack : String(error),
        );
        results.push({
          userId: preference.user.id,
          ok: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return {
      usersProcessed: results.length,
      totalMatched: results.reduce(
        (total, result) => total + (result.ok ? result.matched : 0),
        0,
      ),
      results,
    };
  }

  async matches(userId: string) {
    const preference = await this.preferencesRepository.findOne({ where: { user: { id: userId } }, order: { updatedAt: "DESC" } });
    const allowed = savedLocations(preference);
    const matches = await this.matchesRepository.find({
      where: { user: { id: userId } },
      relations: { job: true },
      order: { score: "DESC", createdAt: "DESC" },
    });
    return matches.filter(match => matchesSavedLocation(match.job.location, allowed));
  }

  async deleteSavedJob(userId: string, jobId: string) {
    return this.jobsRepository.manager.transaction(async manager => {
      const [job] = await manager.query(
        `SELECT job.id FROM jobs job WHERE job.id = $1 AND
        (job."userId" = $2 OR EXISTS (SELECT 1 FROM job_matches m WHERE m."jobId" = job.id AND m."userId" = $2))
        FOR UPDATE`, [jobId, userId],
      );
      if (!job) throw new NotFoundException("Saved job not found.");
      await manager.query('DELETE FROM job_applications WHERE "jobId" = $1 AND "userId" = $2', [jobId, userId]);
      await manager.query('DELETE FROM job_matches WHERE "jobId" = $1 AND "userId" = $2', [jobId, userId]);
      await manager.query(
        `UPDATE jobs SET "userId" = NULL WHERE id = $1 AND "userId" = $2
        AND EXISTS (SELECT 1 FROM job_matches WHERE "jobId" = $1)`, [jobId, userId],
      );
      await manager.query(
        `DELETE FROM jobs WHERE id = $1 AND ("userId" = $2 OR "userId" IS NULL)
        AND NOT EXISTS (SELECT 1 FROM job_matches WHERE "jobId" = $1)`, [jobId, userId],
      );
      return { deleted: true, id: jobId };
    });
  }

  async updateApplicationStatus(userId: string, jobId: string, status: unknown) {
    if (typeof status !== "string" || !applicationStatuses.some(value => value === status)) {
      throw new BadRequestException("Invalid application status.");
    }
    const [application] = await this.jobsRepository.query(
      `INSERT INTO job_applications ("userId", "jobId", status, "updatedAt")
       SELECT $2::uuid, job.id, $3, NOW() FROM jobs job
       WHERE job.id = $1 AND (job."userId" = $2 OR EXISTS
         (SELECT 1 FROM job_matches m WHERE m."jobId" = job.id AND m."userId" = $2))
       ON CONFLICT ("userId", "jobId") DO UPDATE SET status = EXCLUDED.status, "updatedAt" = NOW()
       RETURNING "jobId" AS id, status AS "applicationStatus", "updatedAt" AS "statusUpdatedAt"`,
      [jobId, userId, status],
    );
    if (!application) throw new NotFoundException("Saved job not found.");
    return application;
  }

  async savedJobs(userId: string, period = "all", page = 1, search = "", options: { company?: string; location?: string; sort?: string; direction?: string; size?: number } = {}) {
    if (!["all", "2hours"].includes(period)) throw new BadRequestException("Invalid job period.");
    if (!Number.isInteger(page) || page < 1) throw new BadRequestException("Page must be a positive integer.");
    const size = options.size ?? 20;
    if (![10, 20, 50].includes(size)) throw new BadRequestException("Invalid page size.");
    const sort = options.sort ?? "postedAt";
    if (!["title", "company", "location", "postedAt", "createdAt"].includes(sort)) throw new BadRequestException("Invalid sort column.");
    const direction = options.direction ?? "desc";
    if (!["asc", "desc"].includes(direction)) throw new BadRequestException("Invalid sort direction.");
    const query = this.jobsRepository.createQueryBuilder("job")
      .where('(job."userId" = :userId OR EXISTS (SELECT 1 FROM job_matches m WHERE m."jobId" = job.id AND m."userId" = :userId))', { userId });
    const preference = await this.preferencesRepository.findOne({ where: { user: { id: userId } }, order: { updatedAt: "DESC" } });
    const locations = savedLocations(preference);
    if (!locations.length) query.andWhere("1 = 0");
    else {
      const params: Record<string, string> = {};
      const conditions = locations.map((location, index) => {
        params[`location${index}`] = ` ${location} `;
        return `strpos(' ' || trim(regexp_replace(lower(coalesce(job.location, '')), '[^a-z0-9]+', ' ', 'g')) || ' ', :location${index}) > 0`;
      });
      query.andWhere(`(${conditions.join(" OR ")})`, params);
    }
    if (period !== "all") {
      const now = new Date();
      const since = new Date(now.getTime() - 2 * 60 * 60 * 1000);
      query.andWhere('job."postedAt" >= :since AND job."postedAt" <= :now', { since, now });
    }
    if (search.trim()) query.andWhere("(job.title ILIKE :search OR job.company ILIKE :search)", { search: `%${search.trim().slice(0, 120)}%` });
    if (options.company?.trim()) query.andWhere("job.company ILIKE :company", { company: `%${options.company.trim().slice(0, 120)}%` });
    if (options.location?.trim()) query.andWhere("job.location ILIKE :location", { location: `%${options.location.trim().slice(0, 120)}%` });
    const [items, total] = await query.orderBy(`job."${sort}"`, direction === "asc" ? "ASC" : "DESC", "NULLS LAST").addOrderBy("job.id", "ASC").skip((page - 1) * size).take(size).getManyAndCount();
    const applications: { jobId: string; status: string; updatedAt: Date }[] = items.length ? await this.jobsRepository.query(
      'SELECT "jobId", status, "updatedAt" FROM job_applications WHERE "userId" = $1 AND "jobId" = ANY($2::uuid[])',
      [userId, items.map(job => job.id)],
    ) : [];
    const statuses = new Map(applications.map(application => [application.jobId, application]));
    const [state] = await this.jobsRepository.query('SELECT "nextFetchAt" FROM job_search_states WHERE "userId" = $1', [userId]);
    return { items: items.map(job => ({ ...job, applicationStatus: statuses.get(job.id)?.status ?? "saved", statusUpdatedAt: statuses.get(job.id)?.updatedAt ?? null })), total, page, pageSize: size, nextFetchAt: state?.nextFetchAt ?? null };
  }

  async excel(userId: string) {
    const matches = await this.matches(userId);
    const rows = this.toExportRows(matches);
    const sheet = utils.json_to_sheet(rows);
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, sheet, "Matches");
    return write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  }

  async appendExcel(userId: string) {
    const matches = await this.matches(userId);
    const rows = this.toExportRows(matches);
    const exportPath = this.exportPath(userId);
    const existingRows = this.readExistingRows(exportPath);
    const existingKeys = new Set(
      existingRows.map((row) => row.Url || `${row.Title}:${row.Company}`),
    );
    const newRows = rows.filter((row) => {
      const key = row.Url || `${row.Title}:${row.Company}`;
      return !existingKeys.has(key);
    });
    const mergedRows = [...existingRows, ...newRows];
    const sheet = utils.json_to_sheet(mergedRows);
    const workbook = utils.book_new();

    utils.book_append_sheet(workbook, sheet, "Matches");
    writeFile(workbook, exportPath);

    return {
      appended: newRows.length,
      totalRows: mergedRows.length,
      skippedDuplicates: rows.length - newRows.length,
      file: exportPath,
    };
  }

  private slackEncryptionKey() {
    const secret = this.configService.get<string>("SLACK_ENCRYPTION_KEY") || this.configService.get<string>("JWT_SECRET");
    if (!secret) throw new ServiceUnavailableException("Slack encryption is not configured on the server.");
    return secret;
  }

  private slackOAuthConfig() {
    const clientId = this.configService.get<string>("SLACK_CLIENT_ID");
    const clientSecret = this.configService.get<string>("SLACK_CLIENT_SECRET");
    const redirectUri = this.configService.get<string>("SLACK_REDIRECT_URI");
    if (!clientId || !clientSecret || !redirectUri) throw new ServiceUnavailableException("Connect with Slack is not configured. Set SLACK_CLIENT_ID, SLACK_CLIENT_SECRET and SLACK_REDIRECT_URI on the backend.");
    return { clientId, clientSecret, redirectUri };
  }

  async startSlackOAuth(userId: string) {
    const { clientId, redirectUri } = this.slackOAuthConfig();
    this.slackEncryptionKey();
    const state = randomBytes(32).toString("hex");
    await this.usersRepository.update(userId, {
      slackOAuthStateHash: createHash("sha256").update(state).digest("hex"),
      slackOAuthExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });
    const url = new URL("https://slack.com/oauth/v2/authorize");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("scope", "incoming-webhook");
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    return { url: url.toString(), state };
  }

  async completeSlackOAuth(userId: string, code: unknown, state: unknown) {
    if (typeof code !== "string" || !code || code.length > 2048 || typeof state !== "string" || !/^[a-f0-9]{64}$/.test(state)) {
      throw new BadRequestException("Invalid Slack authorization. Please connect again.");
    }
    const config = this.slackOAuthConfig();
    // Consume the account-bound state atomically before exchanging the code.
    const result = await this.usersRepository.createQueryBuilder().update(User)
      .set({ slackOAuthStateHash: null, slackOAuthExpiresAt: null })
      .where('id = :userId AND "slackOAuthStateHash" = :hash AND "slackOAuthExpiresAt" > :now', {
        userId, hash: createHash("sha256").update(state).digest("hex"), now: new Date(),
      }).execute();
    if (!result.affected) throw new BadRequestException("Slack authorization expired or belongs to another account. Please connect again.");
    let webhookUrl: unknown;
    try {
      const response = await axios.post("https://slack.com/api/oauth.v2.access", new URLSearchParams({
        client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri, code,
      }).toString(), { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 15000 });
      if (!response.data?.ok) throw new Error("Slack authorization failed");
      webhookUrl = response.data.incoming_webhook?.url;
    } catch { throw new ServiceUnavailableException("Slack authorization failed. Please connect again."); }
    return this.saveSlackSettings(userId, webhookUrl);
  }

  async slackSettings(userId: string) {
    const user = await this.usersRepository.findOne({ where: { id: userId }, select: { id: true, slackWebhookEncrypted: true, slackTeamId: true, slackUserId: true } });
    if (!user) throw new NotFoundException("User not found.");
    const linked = !!user.slackUserId && user.slackTeamId === this.configService.get<string>("SLACK_TEAM_ID");
    const botConfigured = !!this.configService.get<string>("SLACK_BOT_TOKEN");
    return { connected: linked ? botConfigured : !!user.slackWebhookEncrypted, linked, botConfigured,
      destination: linked ? "direct-message" : user.slackWebhookEncrypted ? "channel" : null };
  }

  async saveSlackSettings(userId: string, value: unknown) {
    if (typeof value !== "string" || value.length > 500 || !/^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(value.trim())) {
      throw new BadRequestException("Enter a valid Slack incoming webhook URL.");
    }
    const encrypted = encryptWebhook(value.trim(), this.slackEncryptionKey());
    const result = await this.usersRepository.update(userId, { slackWebhookEncrypted: encrypted });
    if (!result.affected) throw new NotFoundException("User not found.");
    return { connected: true, message: "Your Slack channel is connected." };
  }

  async disconnectSlack(userId: string) {
    await this.usersRepository.update(userId, { slackWebhookEncrypted: null, slackOAuthStateHash: null, slackOAuthExpiresAt: null });
    return { connected: false, message: "Slack disconnected." };
  }

  async notifySlack(userId: string) {
    const user = await this.usersRepository.findOne({ where: { id: userId }, select: { id: true, slackWebhookEncrypted: true, slackTeamId: true, slackUserId: true } });
    const direct = !!user?.slackUserId && user.slackTeamId === this.configService.get<string>("SLACK_TEAM_ID");
    if (!direct && !user?.slackWebhookEncrypted) {
      return { sent: 0, message: "Link your Slack account in Slack settings first." };
    }
    let webhookUrl = "";
    try { if (!direct) webhookUrl = decryptWebhook(user!.slackWebhookEncrypted!, this.slackEncryptionKey()); }
    catch { throw new ServiceUnavailableException("Your Slack connection could not be read. Please reconnect Slack."); }


    const pending = await this.matchesRepository.find({
      where: { user: { id: userId }, slackNotified: false },
      relations: { job: true },
      order: { score: "DESC" },
    });

    if (!pending.length) {
      return { sent: 0, message: "No new matches to notify." };
    }

    const batch = pending.slice(0, 10);
    const escapeSlack = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const message = {
      text: `New job matches:\n${batch
        .map((match) => {
          const summary = `${escapeSlack(match.job.title)} (${match.score})`;
          const url = match.job.url;
          return url && /^https?:\/\//i.test(url)
            ? `${summary}\n<${escapeSlack(encodeURI(url))}|View job>`
            : summary;
        })
        .join("\n\n")}`,
    };
    try {
      if (direct) {
        const token = this.configService.get<string>("SLACK_BOT_TOKEN");
        if (!token) throw new Error("Missing bot token");
        const options = { timeout: 15000, headers: { Authorization: `Bearer ${token}` } };
        const identity = await axios.post("https://slack.com/api/auth.test", {}, options);
        if (!identity.data.ok || identity.data.team_id !== user!.slackTeamId) throw new Error("Wrong bot workspace");
        const conversation = await axios.post("https://slack.com/api/conversations.open", { users: user!.slackUserId }, options);
        if (!conversation.data.ok || !conversation.data.channel?.id) throw new Error("Cannot open DM");
        const response = await axios.post("https://slack.com/api/chat.postMessage", { channel: conversation.data.channel.id, ...message }, options);
        if (!response.data.ok) throw new Error("Message rejected");
      } else {
        await new IncomingWebhook(webhookUrl).send(message);
      }
    } catch { throw new ServiceUnavailableException("Slack could not receive the notification. Check the workspace bot configuration and try again."); }

    await Promise.all(
      batch.map((match) =>
        this.matchesRepository.save({ ...match, slackNotified: true }),
      ),
    );

    return { sent: batch.length, message: "Slack notification sent." };
  }

  private async fetchFromApify(preference: JobPreference): Promise<Job[]> {
    const token = this.configService.get<string>("APIFY_TOKEN");
    const actorId = this.configService.get<string>("APIFY_JOB_ACTOR_ID");

    if (!token || !actorId) {
      throw new ServiceUnavailableException("Job search is not configured. Set APIFY_TOKEN and APIFY_JOB_ACTOR_ID on the backend.");
    }

    const normalizedActorId = actorId.trim().replace("/", "~");
    const advancedActor = normalizedActorId === "curious_coder~linkedin-jobs-search-scraper";
    const publicActor = normalizedActorId === "curious_coder~linkedin-jobs-scraper";
    let cookies: Record<string, unknown>[] = [];
    const userAgent = this.configService.get<string>("APIFY_LINKEDIN_USER_AGENT");
    if (advancedActor) {
      try {
        const parsed: unknown = JSON.parse(this.configService.get<string>("APIFY_LINKEDIN_COOKIES") || "[]");
        if (!Array.isArray(parsed) || !parsed.length || parsed.some(cookie => !cookie || typeof cookie.name !== "string" || typeof cookie.value !== "string")) throw new Error();
        cookies = parsed;
      } catch {
        throw new ServiceUnavailableException("This Apify actor requires APIFY_LINKEDIN_COOKIES as a JSON cookie array in backend/.env.");
      }
      if (!userAgent?.trim()) throw new ServiceUnavailableException("This Apify actor requires APIFY_LINKEDIN_USER_AGENT in backend/.env.");
    }
    const runUrl = `https://api.apify.com/v2/acts/${encodeURIComponent(normalizedActorId)}/run-sync-get-dataset-items`;
    const jobs = new Map<string, Job>();
    const combinations = searchCombinations(preference);
    const maxItems = Number(this.configService.get<string>("APIFY_MAX_ITEMS") ?? 20);
    if (!Number.isInteger(maxItems) || maxItems < 1) throw new ServiceUnavailableException("APIFY_MAX_ITEMS must be a positive integer.");
    const inputs = publicActor ? [{
      urls: combinations.map(({ role, location }) => {
        const url = new URL("https://www.linkedin.com/jobs/search/");
        url.searchParams.set("keywords", buildJobQuery(role, preference.skills));
        url.searchParams.set("location", location);
        url.searchParams.set("f_TPR", "r7200");
        return url.toString();
      }),
      limitPerSource: maxItems, scrapeCompany: false,
    }] : combinations.map(({ role, location }) => advancedActor ? {
        cookies, userAgent, count: maxItems,
        filters: { keywords: buildJobQuery(role, preference.skills), ...(location.toLowerCase() === "remote" ? { workplaceType: ["2"] } : { location }), sortBy: "DD", timePostedRange: "r86400" },
        scrapeJobDetails: true,
      } : { query: buildJobQuery(role, preference.skills), location, maxItems });
    for (const input of inputs) {
      let items: ApifyJob[];
      try {
        const response = await axios.post<ApifyJob[]>(runUrl, input, { timeout: 120000, headers: { Authorization: `Bearer ${token}` } });
        if (!Array.isArray(response.data)) throw new Error("Invalid actor response");
        items = response.data;
      } catch {
        // Avoid logging Axios errors: their request config contains session cookies.
        throw new ServiceUnavailableException(advancedActor
          ? "Apify job search failed. Check the actor run in Apify Console, your token, LinkedIn cookies, and account credits."
          : "Apify job search failed. Check the actor run in Apify Console, your API token, actor access, and account credits.");
      }
      for (const item of items) {
        const job = this.mapApifyJob(item);
        jobs.set(job.externalId || job.url || `${job.title}:${job.company}:${job.location}`, job);
      }
    }
    return [...jobs.values()];
  }

  private mapApifyJob(item: ApifyJob): Job {
    return this.jobsRepository.create({
      externalId: item.id,
      title: item.title ?? item.positionName ?? "Untitled role",
      company: item.company ?? item.companyName,
      companyLogo: typeof item.companyLogo === "string" && /^https?:\/\//i.test(item.companyLogo) ? item.companyLogo : undefined,
      location: typeof item.location === "string" ? item.location : item.location?.defaultLocalizedName ?? item.location?.abbreviatedLocalizedName,
      url: item.url ?? item.jobUrl ?? item.link,
      description: item.descriptionText ?? item.description,
      source: "apify",
      postedAt: this.parsePostedDate(item.postedAt ?? item.publishedAt ?? item.postedDate ?? item.datePosted) ?? (typeof item.postedAtTimestamp === "number" && Number.isFinite(item.postedAtTimestamp) && !Number.isNaN(new Date(item.postedAtTimestamp).getTime()) ? new Date(item.postedAtTimestamp) : null),
    });
  }

  private parsePostedDate(value?: string) {
    if (!value || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private demoJobs(preference: JobPreference) {
    return [
      this.jobsRepository.create({
        title: `${preference.targetRole} Developer`,
        company: "DemoTech",
        location: preference.location,
        url: "https://example.com/jobs/demo-next-nest",
        description: `Hiring for ${preference.skills.join(", ")} experience.`,
        source: "demo",
      }),
      this.jobsRepository.create({
        title: "Full Stack Software Engineer",
        company: "Product Studio",
        location: "Remote",
        url: "https://example.com/jobs/demo-fullstack",
        description: "React, Node, NestJS, PostgreSQL, TypeScript.",
        source: "demo",
      }),
    ];
  }

  private scoreJob(user: User, preference: JobPreference, job: Job) {
    const haystack = `${job.title} ${job.description ?? ""}`.toLowerCase();
    const matchedSkills = preference.skills.filter((skill) =>
      haystack.includes(skill.toLowerCase()),
    );
    const roleScore = (preference.targetRoles?.length ? preference.targetRoles : [preference.targetRole]).some(role => haystack.includes(role.toLowerCase()))
      ? 40
      : 0;
    const score = Math.min(100, roleScore + matchedSkills.length * 15);

    return this.matchesRepository.create({
      user,
      job,
      score,
      matchedSkills,
    });
  }

  private toExportRows(matches: JobMatch[]): MatchExportRow[] {
    return matches.map((match) => ({
      Title: match.job.title,
      Company: match.job.company ?? "",
      Location: match.job.location ?? "",
      Score: match.score,
      Skills: match.matchedSkills.join(", "),
      Url: match.job.url ?? "",
      Source: match.job.source,
      ExportedAt: new Date().toISOString(),
    }));
  }

  private exportPath(userId: string) {
    const directory = join(process.cwd(), "exports");
    mkdirSync(directory, { recursive: true });
    return join(directory, `job-matches-${userId}.xlsx`);
  }

  private readExistingRows(path: string): MatchExportRow[] {
    if (!existsSync(path)) {
      return [];
    }

    const workbook = readFile(path);
    const sheetName = workbook.SheetNames[0];

    if (!sheetName) {
      return [];
    }

    return utils.sheet_to_json<MatchExportRow>(workbook.Sheets[sheetName]);
  }
}
