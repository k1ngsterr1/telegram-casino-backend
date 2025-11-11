import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'fs';
import * as path from 'path';

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

  async validateImageFile(file: any): Promise<void> {
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

  async validateVideoFile(file: any): Promise<void> {
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

  async saveVideo(file: any, filename?: string): Promise<string> {
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

  async processAndSaveImage(file: any, filename?: string): Promise<string> {
    await this.validateImageFile(file);

    const originalName = filename || file.originalname;
    const nameWithoutExt = path.parse(originalName).name;
    const timestamp = Date.now();
    const finalFilename = `${nameWithoutExt}_${timestamp}.jpg`;
    const outputPath = path.join(this.uploadPath, finalFilename);

    try {
      // Simple save without sharp processing
      await fs.writeFile(outputPath, file.buffer);
      console.log(`Image saved: ${finalFilename}`);
      return finalFilename;
    } catch (error) {
      console.error('Error saving image:', error);
      throw new BadRequestException('Failed to save image');
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
