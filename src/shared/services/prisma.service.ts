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
  private readonly logger = new Logger(PrismaService.name);
  private isConnected = false;
  private promise: Promise<void> | null = null;

  async onModuleInit() {
    await this.connect();
  }

  async connect() {
    if (this.isConnected) {
      return;
    }

    if (this.promise) {
      return this.promise;
    }

    this.promise = this.$connect().then(() => {
      this.isConnected = true;
      this.logger.log('Prisma connected successfully');
    });

    return this.promise;
  }

  async ensureConnected() {
    if (!this.isConnected) {
      await this.connect();
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.isConnected = false;
    this.logger.log('Prisma disconnected');
  }
}
