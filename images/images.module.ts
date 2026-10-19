import { Inject } from "@nestjs/common";
import { BadRequestException, Controller, Get, Injectable, Module, Post, Req, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { FileInterceptor } from "@nestjs/platform-express";
import { InjectRepository, TypeOrmModule } from "@nestjs/typeorm";
import { v2 as cloudinary, UploadApiResponse } from "cloudinary";
import { Repository } from "typeorm";
import { AuthModule } from "../auth/auth.module";
import type { AuthenticatedRequest } from "../common/authenticated-request";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { UserImage } from "../entities/image.entity";

@Injectable()
class ImagesService {
  constructor(@InjectRepository(UserImage) private readonly images: Repository<UserImage>, @Inject(ConfigService) private readonly config: ConfigService) {}
  list(id: string) { return this.images.find({ where: { user: { id } }, order: { createdAt: "DESC" } }); }
  async upload(id: string, file?: Express.Multer.File) {
    if (!file) throw new BadRequestException("Select a JPG, PNG, or WebP image.");
    const valid = file.mimetype === "image/jpeg" ? file.buffer[0] === 0xff && file.buffer[1] === 0xd8 && file.buffer[2] === 0xff : file.mimetype === "image/png" ? file.buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : file.buffer.subarray(0,4).toString() === "RIFF" && file.buffer.subarray(8,12).toString() === "WEBP";
    if (!valid) throw new BadRequestException("The file is not a valid image.");
    cloudinary.config({ cloud_name: this.config.getOrThrow<string>("CLOUDINARY_CLOUD_NAME"), api_key: this.config.getOrThrow<string>("CLOUDINARY_API_KEY"), api_secret: this.config.getOrThrow<string>("CLOUDINARY_API_SECRET"), secure: true });
    const result = await new Promise<UploadApiResponse>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream({ folder: `job-portal/images/${id}`, resource_type: "image" }, (error, result) => error || !result ? reject(error ?? new Error("Upload failed")) : resolve(result));
      stream.end(file.buffer);
    });
    return this.images.save({ user: { id }, name: file.originalname, url: result.secure_url, publicId: result.public_id, size: file.size });
  }
}

@UseGuards(JwtAuthGuard)
@Controller("images")
class ImagesController {
  constructor(@Inject(ImagesService) private readonly images: ImagesService) {}
  @Get() list(@Req() request: AuthenticatedRequest) { return this.images.list(request.user.id); }
  @Post()
  @UseInterceptors(FileInterceptor("image", { limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: (_request, file, callback) => {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) return callback(new BadRequestException("Only JPG, PNG, and WebP images are supported."), false);
    callback(null, true);
  } }))
  upload(@Req() request: AuthenticatedRequest, @UploadedFile() file: Express.Multer.File) { return this.images.upload(request.user.id, file); }
}

@Module({ imports: [AuthModule, TypeOrmModule.forFeature([UserImage])], controllers: [ImagesController], providers: [ImagesService] })
export class ImagesModule {}
