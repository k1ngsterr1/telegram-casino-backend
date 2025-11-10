import {
  Controller,
  Post,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
  BadRequestException,
  Delete,
  Param,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage, diskStorage } from 'multer';
import { extname } from 'path';
import { UploadService } from './upload.service';
import { ApiTags, ApiConsumes, ApiBody, ApiOperation } from '@nestjs/swagger';

@ApiTags('upload')
@Controller('upload')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @Post('image')
  @ApiOperation({
    summary: 'Upload a single image file',
    description:
      'Upload and automatically convert PNG to JPG with optimization. Supports JPG and PNG formats.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
    }),
  )
  async uploadImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    const filename = await this.uploadService.processAndSaveImage(file);

    return {
      filename,
      originalName: file.originalname,
      size: file.size,
      mimetype: 'image/jpeg', // Always JPG after conversion
      url: await this.uploadService.getFileUrl(filename),
    };
  }

  @Post('images')
  @ApiOperation({
    summary: 'Upload multiple image files',
    description:
      'Upload and automatically convert multiple PNG to JPG with optimization. Supports JPG and PNG formats. Max 10 files.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: {
            type: 'string',
            format: 'binary',
          },
        },
      },
    },
  })
  @UseInterceptors(
    FilesInterceptor('files', 10, {
      storage: memoryStorage(),
    }),
  )
  async uploadImages(@UploadedFiles() files: Express.Multer.File[]) {
    if (!files || files.length === 0) {
      throw new BadRequestException('No files uploaded');
    }

    return Promise.all(
      files.map(async (file) => {
        const filename = await this.uploadService.processAndSaveImage(file);

        return {
          filename,
          originalName: file.originalname,
          size: file.size,
          mimetype: 'image/jpeg', // Always JPG after conversion
          url: await this.uploadService.getFileUrl(filename),
        };
      }),
    );
  }

  @Post('video')
  @ApiOperation({ summary: 'Upload a single video file' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads',
        filename: (req, file, cb) => {
          cb(
            null,
            `${Math.floor(Math.random() * 100000)}_${Date.now()}${extname(file.originalname)}`,
          );
        },
      }),
    }),
  )
  async uploadVideo(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    await this.uploadService.validateVideoFile(file);

    return {
      filename: file.filename,
      originalName: file.originalname,
      size: file.size,
      mimetype: file.mimetype,
      url: await this.uploadService.getFileUrl(file.filename),
    };
  }

  @Post('videos')
  @ApiOperation({ summary: 'Upload multiple video files' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: {
            type: 'string',
            format: 'binary',
          },
        },
      },
    },
  })
  @UseInterceptors(
    FilesInterceptor('files', 5, {
      storage: diskStorage({
        destination: './uploads',
        filename: (req, file, cb) => {
          cb(
            null,
            `${Math.floor(Math.random() * 100000)}_${Date.now()}${extname(file.originalname)}`,
          );
        },
      }),
    }),
  )
  async uploadVideos(@UploadedFiles() files: Express.Multer.File[]) {
    if (!files || files.length === 0) {
      throw new BadRequestException('No files uploaded');
    }

    await Promise.all(
      files.map((file) => this.uploadService.validateVideoFile(file)),
    );

    return Promise.all(
      files.map(async (file) => ({
        filename: file.filename,
        originalName: file.originalname,
        size: file.size,
        mimetype: file.mimetype,
        url: await this.uploadService.getFileUrl(file.filename),
      })),
    );
  }

  @Delete(':filename')
  @ApiOperation({ summary: 'Delete an uploaded file' })
  async deleteFile(@Param('filename') filename: string) {
    await this.uploadService.deleteFile(filename);
    return {
      message: 'File deleted successfully',
      filename,
    };
  }
}
