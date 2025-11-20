import { HttpException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/shared/services/prisma.service';
import { PaginationDto } from 'src/shared/dto/pagination.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class AdminUserService {
  private logger = new Logger(AdminUserService.name);

  constructor(private prisma: PrismaService) {}

  async getAllUsers(pagination: PaginationDto) {
    try {
      const { page = 1, limit = 20 } = pagination;
      const skip = (page - 1) * limit;

      const [users, total] = await Promise.all([
        this.prisma.user.findMany({
          skip,
          take: limit,
          orderBy: {
            createdAt: 'desc',
          },
          select: {
            id: true,
            telegramId: true,
            username: true,
            languageCode: true,
            balance: true,
            rating: true,
            isBanned: true,
            role: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
        this.prisma.user.count(),
      ]);

      return {
        data: users,
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      this.logger.error('Failed to get users: ', error);
      throw new HttpException('Failed to get users', 500);
    }
  }

  async getUserById(id: string) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id },
        include: {
          inventory: {
            include: {
              prize: true,
            },
          },
        },
      });

      if (!user) {
        throw new HttpException('User not found', 404);
      }

      return user;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error('Failed to get user: ', error);
      throw new HttpException('Failed to get user', 500);
    }
  }

  async updateUser(id: string, updateUserDto: UpdateUserDto) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id },
      });

      if (!user) {
        throw new HttpException('User not found', 404);
      }

      const updatedUser = await this.prisma.user.update({
        where: { id },
        data: updateUserDto,
        select: {
          id: true,
          telegramId: true,
          username: true,
          languageCode: true,
          balance: true,
          rating: true,
          isBanned: true,
          role: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return updatedUser;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error('Failed to update user: ', error);
      throw new HttpException('Failed to update user', 500);
    }
  }

  async deleteUser(id: string) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id },
      });

      if (!user) {
        throw new HttpException('User not found', 404);
      }

      await this.prisma.user.delete({
        where: { id },
      });

      return { message: 'User deleted successfully' };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error('Failed to delete user: ', error);
      throw new HttpException('Failed to delete user', 500);
    }
  }

  async banUser(id: string) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id },
      });

      if (!user) {
        throw new HttpException('User not found', 404);
      }

      const updatedUser = await this.prisma.user.update({
        where: { id },
        data: { isBanned: true },
        select: {
          id: true,
          telegramId: true,
          username: true,
          rating: true,
          isBanned: true,
        },
      });

      return updatedUser;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error('Failed to ban user: ', error);
      throw new HttpException('Failed to ban user', 500);
    }
  }

  async unbanUser(id: string) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id },
      });

      if (!user) {
        throw new HttpException('User not found', 404);
      }

      const updatedUser = await this.prisma.user.update({
        where: { id },
        data: { isBanned: false },
        select: {
          id: true,
          telegramId: true,
          username: true,
          rating: true,
          isBanned: true,
        },
      });

      return updatedUser;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error('Failed to unban user: ', error);
      throw new HttpException('Failed to unban user', 500);
    }
  }

  async updateBalance(id: string, balance: number) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id },
      });

      if (!user) {
        throw new HttpException('User not found', 404);
      }

      if (balance < 0) {
        throw new HttpException('Balance cannot be negative', 400);
      }

      const updatedUser = await this.prisma.user.update({
        where: { id },
        data: { balance },
        select: {
          id: true,
          telegramId: true,
          username: true,
          balance: true,
          rating: true,
        },
      });

      return updatedUser;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error('Failed to update balance: ', error);
      throw new HttpException('Failed to update balance', 500);
    }
  }
}
