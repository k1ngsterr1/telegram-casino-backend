import {
  Injectable,
  Logger,
  HttpException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../shared/services/prisma.service';
import { BotService } from '../shared/services/bot.service';
import { GetCasesDto, CaseSortBy } from './dto/get-cases.dto';
import { GetCasesCursorDto } from './dto/get-cases-cursor.dto';
import {
  CaseResponseDto,
  FreeCaseCooldownDto,
  SubscriptionRequirementDto,
} from './dto/case-response.dto';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SystemKey } from '@prisma/client';

// Interface for subscription configuration
interface SubscriptionConfig {
  chatId: string;
  title: string;
  inviteLink?: string;
}

@Injectable()
export class CaseService {
  private readonly logger = new Logger(CaseService.name);
  private casesCache: CaseResponseDto[] = [];
  private cacheLastUpdated: Date | null = null;
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  private readonly FREE_CASE_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours
  private websocketGateway: any; // Will be set by WebsocketGateway

  constructor(
    private readonly prisma: PrismaService,
    private readonly botService: BotService,
  ) {}

  /**
   * Set WebSocket gateway reference (called by WebsocketGateway)
   */
  setWebSocketGateway(gateway: any) {
    this.websocketGateway = gateway;
    this.logger.log('✅ WebSocket gateway reference set');
  }

  /**
   * Refresh cache every 5 minutes
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async refreshCache() {
    try {
      await this.loadCasesIntoCache();
      this.logger.log('Cases cache refreshed successfully');
    } catch (error) {
      this.logger.error('Failed to refresh cases cache', error);
    }
  }

  /**
   * Load all cases into cache
   */
  private async loadCasesIntoCache() {
    await this.prisma.ensureConnected();

    const cases = await this.prisma.case.findMany({
      select: {
        id: true,
        name: true,
        price: true,
        preview: true,
        createdAt: true,
      },
      orderBy: {
        price: 'asc',
      },
    });

    this.casesCache = cases.map((c) => ({
      id: c.id,
      name: c.name,
      price: c.price,
      preview: c.preview,
      isFree: c.price === 0,
      createdAt: c.createdAt,
    }));

    this.cacheLastUpdated = new Date();
  }

  /**
   * Check if cache is valid
   */
  private isCacheValid(): boolean {
    if (!this.cacheLastUpdated || this.casesCache.length === 0) {
      return false;
    }
    const now = new Date().getTime();
    const lastUpdate = this.cacheLastUpdated.getTime();
    return now - lastUpdate < this.CACHE_TTL_MS;
  }

  /**
   * Get all cases with pagination and sorting (from cache)
   */
  async findAll(getCasesDto: GetCasesDto) {
    try {
      // Ensure cache is loaded
      if (!this.isCacheValid()) {
        await this.loadCasesIntoCache();
      }

      // Sort cases based on sortBy parameter
      let sortedCases = [...this.casesCache];

      switch (getCasesDto.sortBy) {
        case CaseSortBy.PRICE_ASC:
          sortedCases.sort((a, b) => a.price - b.price);
          break;
        case CaseSortBy.PRICE_DESC:
          sortedCases.sort((a, b) => b.price - a.price);
          break;
        case CaseSortBy.NAME_ASC:
          sortedCases.sort((a, b) => a.name.localeCompare(b.name));
          break;
        case CaseSortBy.NAME_DESC:
          sortedCases.sort((a, b) => b.name.localeCompare(a.name));
          break;
        case CaseSortBy.CREATED_ASC:
          sortedCases.sort(
            (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
          );
          break;
        case CaseSortBy.CREATED_DESC:
          sortedCases.sort(
            (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
          );
          break;
      }

      // Apply pagination
      const { page = 1, limit = 20 } = getCasesDto;
      const skip = (page - 1) * limit;
      const total = sortedCases.length;
      const data = sortedCases.slice(skip, skip + limit);

      return {
        data,
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
      this.logger.error('Failed to get cases', error);
      throw new HttpException('Failed to get cases', 500);
    }
  }

  /**
   * Get all cases with cursor-based pagination
   * More efficient for large datasets and real-time updates
   */
  async findAllCursor(getCasesCursorDto: GetCasesCursorDto) {
    try {
      const {
        cursor,
        limit = 20,
        sortBy = CaseSortBy.PRICE_ASC,
      } = getCasesCursorDto;

      // Determine order direction and field
      let orderBy: any = {};
      switch (sortBy) {
        case CaseSortBy.PRICE_ASC:
          orderBy = { price: 'asc' };
          break;
        case CaseSortBy.PRICE_DESC:
          orderBy = { price: 'desc' };
          break;
        case CaseSortBy.NAME_ASC:
          orderBy = { name: 'asc' };
          break;
        case CaseSortBy.NAME_DESC:
          orderBy = { name: 'desc' };
          break;
        case CaseSortBy.CREATED_ASC:
          orderBy = { createdAt: 'asc' };
          break;
        case CaseSortBy.CREATED_DESC:
          orderBy = { createdAt: 'desc' };
          break;
      }

      // Fetch limit + 1 to check if there's a next page
      const cases = await this.prisma.case.findMany({
        take: limit + 1,
        skip: cursor ? 1 : 0, // Skip the cursor item itself
        cursor: cursor ? { id: cursor } : undefined,
        select: {
          id: true,
          name: true,
          price: true,
          preview: true,
          createdAt: true,
        },
        orderBy,
      });

      // Check if there's a next page
      const hasNextPage = cases.length > limit;
      const data = hasNextPage ? cases.slice(0, limit) : cases;

      // Get next cursor (last item's ID)
      const nextCursor = hasNextPage ? data[data.length - 1].id : null;

      return {
        data: data.map((c) => ({
          id: c.id,
          name: c.name,
          price: c.price,
          preview: c.preview,
          isFree: c.price === 0,
          createdAt: c.createdAt,
        })),
        meta: {
          nextCursor,
          hasNextPage,
          limit,
        },
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error('Failed to get cases with cursor pagination', error);
      throw new HttpException('Failed to get cases', 500);
    }
  }

  /**
   * Get case by ID with detailed items
   */
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
        throw new HttpException('Case not found', 404);
      }

      return {
        id: caseData.id,
        name: caseData.name,
        price: caseData.price,
        preview: caseData.preview,
        isFree: caseData.price === 0,
        items: caseData.items.map((item) => ({
          id: item.id,
          name: item.name,
          chance: Number(item.chance),
          prizeId: item.prizeId,
          prize: {
            id: item.prize.id,
            name: item.prize.name,
            amount: item.prize.amount,
            url: item.prize.url,
          },
        })),
        createdAt: caseData.createdAt,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error('Failed to get case', error);
      throw new HttpException('Failed to get case', 500);
    }
  }

  /**
   * Get subscription requirements from system settings
   */
  private async getSubscriptionRequirements(): Promise<SubscriptionConfig[]> {
    try {
      const config = await this.prisma.system.findUnique({
        where: { key: SystemKey.FREE_CASE_SUBSCRIPTIONS },
        select: { value: true },
      });

      if (!config || !config.value) {
        return [];
      }

      const parsed = JSON.parse(config.value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      this.logger.error('Failed to parse subscription requirements', error);
      return [];
    }
  }

  /**
   * Check user's subscription status for all required chats
   */
  async checkSubscriptionStatus(telegramUserId: string): Promise<{
    subscriptions: SubscriptionRequirementDto[];
    allSubscriptionsMet: boolean;
  }> {
    const requirements = await this.getSubscriptionRequirements();

    if (requirements.length === 0) {
      return {
        subscriptions: [],
        allSubscriptionsMet: true,
      };
    }

    const subscriptions: SubscriptionRequirementDto[] = [];

    for (const req of requirements) {
      const membership = await this.botService.checkChatMembership(
        req.chatId,
        telegramUserId,
      );

      subscriptions.push({
        chatId: req.chatId,
        title: membership.chatTitle || req.title,
        isSubscribed: membership.isMember,
        inviteLink: req.inviteLink,
      });
    }

    const allSubscriptionsMet = subscriptions.every((s) => s.isSubscribed);

    return {
      subscriptions,
      allSubscriptionsMet,
    };
  }

  /**
   * Check free case cooldown for a user
   */
  async checkFreeCaseCooldown(
    caseId: number,
    userId: string,
  ): Promise<FreeCaseCooldownDto> {
    try {
      // Verify case exists and is free
      const caseData = await this.prisma.case.findUnique({
        where: { id: caseId },
        select: { id: true, price: true },
      });

      if (!caseData) {
        throw new HttpException('Case not found', 404);
      }

      if (caseData.price !== 0) {
        throw new HttpException('This is not a free case', 400);
      }

      // Get user's telegram ID for subscription check
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { telegramId: true },
      });

      if (!user) {
        throw new HttpException('User not found', 404);
      }

      // Check subscription requirements
      const subscriptionStatus = await this.checkSubscriptionStatus(
        user.telegramId,
      );

      // Find the most recent opening of this case by the user
      const lastOpening = await this.prisma.inventoryItem.findFirst({
        where: {
          userId,
          caseId,
        },
        orderBy: {
          createdAt: 'desc',
        },
        select: {
          createdAt: true,
        },
      });

      if (!lastOpening) {
        // User has never opened this case
        return {
          canOpen: subscriptionStatus.allSubscriptionsMet,
          secondsRemaining: null,
          lastOpenedAt: null,
          nextAvailableAt: null,
          subscriptions: subscriptionStatus.subscriptions,
          allSubscriptionsMet: subscriptionStatus.allSubscriptionsMet,
        };
      }

      const now = new Date();
      const lastOpenedAt = lastOpening.createdAt;
      const nextAvailableAt = new Date(
        lastOpenedAt.getTime() + this.FREE_CASE_COOLDOWN_MS,
      );
      const timeDiff = nextAvailableAt.getTime() - now.getTime();

      if (timeDiff <= 0) {
        // Cooldown has passed
        return {
          canOpen: subscriptionStatus.allSubscriptionsMet,
          secondsRemaining: null,
          lastOpenedAt,
          nextAvailableAt: null,
          subscriptions: subscriptionStatus.subscriptions,
          allSubscriptionsMet: subscriptionStatus.allSubscriptionsMet,
        };
      }

      // Still in cooldown
      return {
        canOpen: false,
        secondsRemaining: Math.ceil(timeDiff / 1000),
        lastOpenedAt,
        nextAvailableAt,
        subscriptions: subscriptionStatus.subscriptions,
        allSubscriptionsMet: subscriptionStatus.allSubscriptionsMet,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error('Failed to check free case cooldown', error);
      throw new HttpException('Failed to check free case cooldown', 500);
    }
  }

  /**
   * Weighted random selection based on chances
   * Uses cumulative probability distribution
   */
  private selectPrizeByChance<T extends { chance: any }>(items: T[]): T {
    if (!items || items.length === 0) {
      throw new HttpException('Case has no items', 500);
    }

    // Calculate total weight (sum of all chances)
    const totalWeight = items.reduce(
      (sum, item) => sum + Number(item.chance),
      0,
    );

    if (totalWeight <= 0) {
      throw new HttpException(
        'Invalid case configuration: total chance is 0',
        500,
      );
    }

    // Generate random number between 0 and totalWeight
    const random = Math.random() * totalWeight;

    // Find the item based on cumulative probability
    let cumulativeWeight = 0;
    for (const item of items) {
      cumulativeWeight += Number(item.chance);
      if (random <= cumulativeWeight) {
        return item;
      }
    }

    // Fallback to last item (should never reach here due to floating point precision)
    return items[items.length - 1];
  }

  /**
   * Open a case for a user (with multiplier support)
   * - Validates case exists and has items
   * - For free cases: validates 24h cooldown and subscription requirements
   * - For paid cases: validates user has sufficient balance
   * - Selects prizes based on weighted random for each opening
   * - Decrements user balance (if paid case)
   * - Adds prizes to user inventory with caseId tracking
   * All in one atomic transaction
   */
  async openCase(caseId: number, userId: string, multiplier: number) {
    try {
      // First, check subscription requirements for free cases (outside transaction)
      const caseCheck = await this.prisma.case.findUnique({
        where: { id: caseId },
        select: { price: true },
      });

      if (!caseCheck) {
        throw new HttpException('Case not found', 404);
      }

      const isFreeCase = caseCheck.price === 0;

      // For free cases, verify subscription requirements before opening
      if (isFreeCase) {
        const user = await this.prisma.user.findUnique({
          where: { id: userId },
          select: { telegramId: true },
        });

        if (!user) {
          throw new HttpException('User not found', 404);
        }

        const subscriptionStatus = await this.checkSubscriptionStatus(
          user.telegramId,
        );

        if (!subscriptionStatus.allSubscriptionsMet) {
          const unsubscribed = subscriptionStatus.subscriptions
            .filter((s) => !s.isSubscribed)
            .map((s) => s.title)
            .join(', ');
          throw new HttpException(
            `You must subscribe to the following to open this free case: ${unsubscribed}`,
            403,
          );
        }
      }

      // Execute everything in a transaction
      const result = await this.prisma.$transaction(async (tx) => {
        // 1. Fetch case with items and prizes
        const caseData = await tx.case.findUnique({
          where: { id: caseId },
          include: {
            items: {
              include: {
                prize: true,
              },
            },
          },
        });

        if (!caseData) {
          throw new HttpException('Case not found', 404);
        }

        if (!caseData.items || caseData.items.length === 0) {
          throw new HttpException('Case has no items configured', 400);
        }

        const isFreeCase = caseData.price === 0;

        // 2. For free cases, check 24h cooldown
        if (isFreeCase) {
          if (multiplier !== 1) {
            throw new HttpException(
              'Free cases can only be opened once at a time',
              400,
            );
          }

          const lastOpening = await tx.inventoryItem.findFirst({
            where: {
              userId,
              caseId,
            },
            orderBy: {
              createdAt: 'desc',
            },
            select: {
              createdAt: true,
            },
          });

          if (lastOpening) {
            const now = new Date();
            const timeSinceLastOpen =
              now.getTime() - lastOpening.createdAt.getTime();

            if (timeSinceLastOpen < this.FREE_CASE_COOLDOWN_MS) {
              const secondsRemaining = Math.ceil(
                (this.FREE_CASE_COOLDOWN_MS - timeSinceLastOpen) / 1000,
              );
              throw new HttpException(
                `Free case on cooldown. ${secondsRemaining} seconds remaining`,
                400,
              );
            }
          }
        }

        // 3. Calculate total cost for paid cases
        const totalCost = caseData.price * multiplier;

        // 4. Fetch user and check balance (if paid case)
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: { id: true, balance: true, isBanned: true, username: true },
        });

        if (!user) {
          throw new HttpException('User not found', 404);
        }

        if (user.isBanned) {
          throw new HttpException('User is banned', 403);
        }

        let remainingBalance = user.balance.toNumber();

        if (!isFreeCase) {
          if (user.balance.lt(totalCost)) {
            throw new HttpException('Insufficient balance', 400);
          }

          // 5. Decrement user balance and update stats with updateMany and gte check
          const updateResult = await tx.user.updateMany({
            where: {
              id: userId,
              balance: {
                gte: totalCost,
              },
            },
            data: {
              balance: {
                decrement: totalCost,
              },
              totalVolume: {
                increment: totalCost,
              },
              totalSpins: {
                increment: multiplier,
              },
            },
          });

          if (updateResult.count === 0) {
            throw new HttpException('Insufficient balance', 400);
          }

          remainingBalance -= totalCost;
        } else {
          // For free cases, only update totalSpins
          await tx.user.update({
            where: { id: userId },
            data: {
              totalSpins: {
                increment: multiplier,
              },
            },
          });
        }

        // 6. Open cases multiple times based on multiplier
        const wonPrizes = [];
        const inventoryData = [];

        for (let i = 0; i < multiplier; i++) {
          // Select prize using weighted random
          const selectedItem = this.selectPrizeByChance(caseData.items);
          const prize = selectedItem.prize;

          wonPrizes.push(prize);
          inventoryData.push({
            userId: userId,
            prizeId: prize.id,
            caseId: caseId, // Track which case this prize came from
          });
        }

        // Add all prizes to inventory in one request
        const inventoryResult = await tx.inventoryItem.createMany({
          data: inventoryData,
        });

        return {
          prizes: wonPrizes,
          inventoryCount: inventoryResult.count,
          remainingBalance,
          caseName: caseData.name,
          username: user.username,
        };
      });

      // Invalidate cache if it was a mutation
      this.cacheLastUpdated = null;

      // Broadcast prize wins via WebSocket (for each prize won)
      if (this.websocketGateway) {
        for (const prize of result.prizes) {
          this.websocketGateway.broadcastPrizeWon({
            username: result.username,
            caseName: result.caseName,
            prizeName: prize.name,
            prizeAmount: prize.amount,
            prizeUrl: prize.url,
            timestamp: new Date().toISOString(),
            isFake: false,
          });
        }
      }

      // Return formatted response
      return {
        prizes: result.prizes.map((prize) => ({
          prizeId: prize.id,
          prizeName: prize.name,
          prizeAmount: prize.amount,
          prizeUrl: prize.url,
        })),
        remainingBalance: result.remainingBalance,
        totalPrizesWon: result.prizes.length,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error('Failed to open case', error);
      throw new HttpException('Failed to open case', 500);
    }
  }
}
