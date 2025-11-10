import { Injectable, Logger, HttpException } from '@nestjs/common';
import { PrismaService } from '../../shared/services/prisma.service';
import { CreateCaseDto } from './dto/create-case.dto';
import { UpdateCaseDto } from './dto/update-case.dto';
import { PaginationDto } from '../../shared/dto/pagination.dto';

@Injectable()
export class AdminCaseService {
  private readonly logger = new Logger(AdminCaseService.name);

  constructor(private prisma: PrismaService) {}

  async create(createCaseDto: CreateCaseDto) {
    try {
      const prizeIds = createCaseDto.items.map((item) => item.prizeId);
      const prizes = await this.prisma.prize.findMany({
        where: { id: { in: prizeIds } },
        select: { id: true },
      });

      if (prizes.length !== prizeIds.length) {
        const foundIds = prizes.map((p) => p.id);
        const missingIds = prizeIds.filter((id) => !foundIds.includes(id));
        throw new HttpException(
          `Prize(s) not found with ID(s): ${missingIds.join(', ')}`,
          400,
        );
      }

      // Validate total chance is 100
      const totalChance = createCaseDto.items.reduce(
        (sum, item) => sum + item.chance,
        0,
      );
      if (totalChance !== 100) {
        throw new HttpException(
          `Total chance must equal 100, got ${totalChance}`,
          400,
        );
      }

      const caseData = await this.prisma.case.create({
        data: {
          name: createCaseDto.name,
          price: createCaseDto.price,
          preview: createCaseDto.preview,
          items: {
            create: createCaseDto.items.map((item) => ({
              name: item.name,
              prizeId: item.prizeId,
              chance: item.chance,
            })),
          },
        },
        include: {
          items: {
            include: {
              prize: true,
            },
          },
        },
      });

      return caseData;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error('Failed to create case', error);
      throw new HttpException('Failed to create case', 500);
    }
  }

  async findAll(paginationDto: PaginationDto) {
    try {
      const { page = 1, limit = 20 } = paginationDto;
      const skip = (page - 1) * limit;

      const [cases, total] = await Promise.all([
        this.prisma.case.findMany({
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            items: true,
          },
        }),
        this.prisma.case.count(),
      ]);

      return {
        data: cases,
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error('Failed to fetch cases', error);
      throw new HttpException('Failed to fetch cases', 500);
    }
  }

  async findOne(id: number) {
    try {
      const caseData = await this.prisma.case.findUnique({
        where: { id },
        include: {
          items: {
            include: {
              prize: true,
            },
          },
        },
      });

      if (!caseData) {
        throw new HttpException(`Case with ID ${id} not found`, 404);
      }

      return caseData;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error(`Failed to fetch case ${id}`, error);
      throw new HttpException('Failed to fetch case', 500);
    }
  }

  async update(id: number, updateCaseDto: UpdateCaseDto) {
    try {
      // Check if case exists
      await this.findOne(id);

      // If items are being updated, validate prizes and chance
      if (updateCaseDto.items) {
        const prizeIds = updateCaseDto.items.map((item) => item.prizeId);
        const prizes = await this.prisma.prize.findMany({
          where: { id: { in: prizeIds } },
          select: { id: true },
        });

        if (prizes.length !== prizeIds.length) {
          const foundIds = prizes.map((p) => p.id);
          const missingIds = prizeIds.filter((id) => !foundIds.includes(id));
          throw new HttpException(
            `Prize(s) not found with ID(s): ${missingIds.join(', ')}`,
            400,
          );
        }

        // Validate total chance is 100
        const totalChance = updateCaseDto.items.reduce(
          (sum, item) => sum + item.chance,
          0,
        );
        if (totalChance !== 100) {
          throw new HttpException(
            `Total chance must equal 100, got ${totalChance}`,
            400,
          );
        }

        // Delete existing items and create new ones
        await this.prisma.caseItem.deleteMany({
          where: { caseId: id },
        });

        const caseData = await this.prisma.case.update({
          where: { id },
          data: {
            name: updateCaseDto.name,
            price: updateCaseDto.price,
            preview: updateCaseDto.preview,
            items: {
              create: updateCaseDto.items.map((item) => ({
                name: item.name,
                prizeId: item.prizeId,
                chance: item.chance,
              })),
            },
          },
          include: {
            items: {
              include: {
                prize: true,
              },
            },
          },
        });

        return caseData;
      } else {
        const caseData = await this.prisma.case.update({
          where: { id },
          data: {
            name: updateCaseDto.name,
            price: updateCaseDto.price,
            preview: updateCaseDto.preview,
          },
          include: {
            items: {
              include: {
                prize: true,
              },
            },
          },
        });

        return caseData;
      }
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error(`Failed to update case ${id}`, error);
      throw new HttpException('Failed to update case', 500);
    }
  }

  async remove(id: number) {
    try {
      // Check if case exists
      await this.findOne(id);

      // Delete case items first (cascade delete)
      await this.prisma.caseItem.deleteMany({
        where: { caseId: id },
      });

      await this.prisma.case.delete({
        where: { id },
      });

      return { message: 'Case deleted successfully' };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error(`Failed to delete case ${id}`, error);
      throw new HttpException('Failed to delete case', 500);
    }
  }
}
