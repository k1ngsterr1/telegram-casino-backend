import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private isConnected = false;
  private promise: Promise<void> | null = null;
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    await this.ensureConnected();
  }

  async ensureConnected(maxRetries: number = 10, delayMs: number = 3000) {
    // If already connected, return immediately
    if (this.isConnected) {
      return;
    }

    // If a connection attempt is already in progress, wait for it
    if (this.promise) {
      return this.promise;
    }

    // Start a new connection attempt and store the promise
    this.promise = this.connectWithRetry(maxRetries, delayMs);

    try {
      await this.promise;
    } finally {
      // Clear the promise once connection attempt is complete (success or failure)
      this.promise = null;
    }
  }

  private async connectWithRetry(maxRetries: number, delayMs: number) {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.logger.log(
          `Attempting to connect to database (attempt ${attempt}/${maxRetries})...`,
        );
        await this.$connect();
        this.isConnected = true;
        this.logger.log('Successfully connected to database');
        return;
      } catch (error) {
        lastError = error as Error;
        this.logger.warn(
          `Failed to connect to database (attempt ${attempt}/${maxRetries}): ${lastError.message}`,
        );

        if (attempt < maxRetries) {
          const delay = delayMs * attempt; // Exponential backoff
          this.logger.log(`Retrying in ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    this.logger.error(
      `Failed to connect to database after ${maxRetries} attempts`,
    );
    throw new Error(
      `Database connection failed after ${maxRetries} retries: ${lastError?.message || 'Unknown error'}`,
    );
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
