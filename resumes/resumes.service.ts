import { Inject } from "@nestjs/common";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { v2 as cloudinary, UploadApiResponse } from "cloudinary";
import { Repository } from "typeorm";

import { Resume } from "../entities/resume.entity";
import { User } from "../entities/user.entity";
import { extractKeywords } from "./resume-keywords";
import { PreferencesService } from "../preferences/preferences.service";

@Injectable()
export class ResumesService {
  constructor(
    @InjectRepository(Resume)
    private readonly resumesRepository: Repository<Resume>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(PreferencesService) private readonly preferencesService?: PreferencesService,
  ) {}

  async upload(userId: string, file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException("Resume file is required");
    }

    const user = await this.usersRepository.findOne({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException("User not found");
    }

    let text: string;
    try {
      if (file.mimetype === "application/pdf") {
        const { PDFParse } = await import("pdf-parse");
        const parser = new PDFParse({ data: new Uint8Array(file.buffer) });
        try { text = (await parser.getText()).text; } finally { await parser.destroy(); }
      } else if (file.mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
        const mammoth = await import("mammoth");
        text = (await mammoth.extractRawText({ buffer: file.buffer })).value;
      } else {
        throw new BadRequestException("Use a PDF or DOCX resume for keyword extraction. Convert older DOC files to DOCX first.");
      }
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException("Could not read this resume. Upload a valid, unlocked PDF or DOCX file.");
    }
    if (text.replace(/\s/g, "").length < 20) throw new BadRequestException("No readable text found. Scanned resumes need OCR; upload a text-based PDF or DOCX instead.");
    const analysis = extractKeywords(text);
    const upload = await this.uploadToCloudinary(file);

    const resume = await this.resumesRepository.save({
      user,
      originalName: file.originalname,
      storedName: upload.public_id,
      path: upload.secure_url,
      cloudinaryPublicId: upload.public_id,
      secureUrl: upload.secure_url,
      mimeType: file.mimetype,
      size: file.size,
      keywords: analysis.keywords,
      suggestedRole: analysis.suggestedRole,
    });
    const previous = await this.preferencesService?.latest(userId);
    const targetRole = analysis.suggestedRole || previous?.targetRole;
    if (targetRole && analysis.keywords.length && this.preferencesService) {
      await this.preferencesService.save(userId, { targetRole, targetRoles: previous?.targetRoles?.length ? previous.targetRoles : undefined, locations: previous?.locations ?? undefined, skills: analysis.keywords, location: previous?.location, jobType: previous?.jobType });
    }
    return {
      id: resume.id,
      originalName: resume.originalName,
      mimeType: resume.mimeType,
      size: resume.size,
      keywords: resume.keywords,
      suggestedRole: resume.suggestedRole,
      createdAt: resume.createdAt,
    };
  }

  list(userId: string) {
    return this.resumesRepository.find({
      where: { user: { id: userId } },
      order: { createdAt: "DESC" },
    });
  }

  private uploadToCloudinary(file: Express.Multer.File) {
    cloudinary.config({
      cloud_name: this.configService.getOrThrow<string>("CLOUDINARY_CLOUD_NAME"),
      api_key: this.configService.getOrThrow<string>("CLOUDINARY_API_KEY"),
      api_secret: this.configService.getOrThrow<string>("CLOUDINARY_API_SECRET"),
      secure: true,
    });

    return new Promise<UploadApiResponse>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: this.configService.get<string>("CLOUDINARY_RESUME_FOLDER") ?? "job-portal/resumes",
          resource_type: "raw",
          type: "private",
          use_filename: true,
          unique_filename: true,
        },
        (error, result) => {
          if (error || !result) {
            reject(error ?? new Error("Cloudinary upload failed"));
            return;
          }

          resolve(result);
        },
      );

      stream.end(file.buffer);
    });
  }
}
