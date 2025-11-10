import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Express } from 'express';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as sharp from 'sharp';

@Injectable()
export class UploadService {
  private readonly UPLOAD_URL: string;
  private readonly uploadPath = path.join(process.cwd(), 'uploads');
  private readonly allowedImageTypes = ['image/jpeg', 'image/jpg', 'image/png'];
  private readonly allowedVideoTypes = [
    'video/mp4',
    'video/mpeg',
    'video/quicktime',
    'video/x-msvideo',
    'video/webm',
  ];
  private readonly maxImageSize = 5 * 1024 * 1024; // 5MB
  private readonly maxVideoSize = 50 * 1024 * 1024; // 50MB

  constructor(private configService: ConfigService) {
    this.UPLOAD_URL = this.configService.get<string>('UPLOAD_URL');
    this.ensureUploadDirectoryExists();
  }

  private async ensureUploadDirectoryExists(): Promise<void> {
    try {
      await fs.access(this.uploadPath);
    } catch {
      await fs.mkdir(this.uploadPath, { recursive: true });
    }
  }

  async validateImageFile(file: Express.Multer.File): Promise<void> {
    if (!this.allowedImageTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        `Invalid image type. Allowed types: ${this.allowedImageTypes.join(', ')}`,
      );
    }
    if (file.size > this.maxImageSize) {
      throw new BadRequestException(
        `Image size exceeds maximum allowed size of ${this.maxImageSize / 1024 / 1024}MB`,
      );
    }
  }

  async validateVideoFile(file: Express.Multer.File): Promise<void> {
    if (!this.allowedVideoTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        `Invalid video type. Allowed types: ${this.allowedVideoTypes.join(', ')}`,
      );
    }
    if (file.size > this.maxVideoSize) {
      throw new BadRequestException(
        `Video size exceeds maximum allowed size of ${this.maxVideoSize / 1024 / 1024}MB`,
      );
    }
  }

  async saveVideo(
    file: Express.Multer.File,
    filename?: string,
  ): Promise<string> {
    await this.validateVideoFile(file);

    const originalName = filename || file.originalname;
    const nameWithoutExt = path.parse(originalName).name;
    const timestamp = Date.now();
    const ext = path.parse(originalName).ext || '.mp4';
    const finalFilename = `${nameWithoutExt}_${timestamp}${ext}`;
    const outputPath = path.join(this.uploadPath, finalFilename);

    try {
      await fs.writeFile(outputPath, file.buffer);
      console.log(`Video saved: ${finalFilename}`);
      return finalFilename;
    } catch (error) {
      console.error('Error saving video:', error);
      throw new BadRequestException('Failed to save video');
    }
  }

  async processAndSaveImage(
    file: Express.Multer.File,
    filename?: string,
  ): Promise<string> {
    await this.validateImageFile(file);

    const originalName = filename || file.originalname;
    const nameWithoutExt = path.parse(originalName).name;
    const timestamp = Date.now();
    const finalFilename = `${nameWithoutExt}_${timestamp}.jpg`;
    const outputPath = path.join(this.uploadPath, finalFilename);

    try {
      // Convert image to JPG with compression and quality optimization
      await sharp(file.buffer)
        .jpeg({
          quality: 85, // Good balance between quality and file size
          progressive: true, // Progressive JPEG for better web loading
          mozjpeg: true, // Use mozjpeg encoder for better compression
        })
        .resize({
          width: 1920, // Max width
          height: 1920, // Max height
          fit: sharp.fit.inside, // Maintain aspect ratio
          withoutEnlargement: true, // Don't upscale smaller images
        })
        .toFile(outputPath);

      console.log(`Image processed and saved: ${finalFilename}`);
      return finalFilename;
    } catch (error) {
      console.error('Error processing image:', error);
      throw new BadRequestException('Failed to process image');
    }
  }

  async getFileUrl(filename: string): Promise<string> {
    return `${this.UPLOAD_URL}/uploads/${filename}`;
  }

  async deleteFile(filename: string): Promise<void> {
    const filePath = path.join(this.uploadPath, filename);
    try {
      await fs.access(filePath);
      await fs.unlink(filePath);
    } catch (error) {
      console.log('File not found or already deleted:', filename);
    }
  }
}
