import {
  Injectable,
  Logger,
  OnModuleInit,
  HttpException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/services/prisma.service';
import { SystemKey, AviatorStatus } from '@prisma/client';
import * as crypto from 'crypto';

export interface AviatorSettings {
  minMultiplier: number;
  maxMultiplier: number;
  minBet: number;
  maxBet: number;
  targetRtp: number;
  instantCrashP: number;
}

@Injectable()
export class AviatorService implements OnModuleInit {
  private readonly logger = new Logger(AviatorService.name);
  private aviatorSettings: AviatorSettings = {
    minMultiplier: 1.0,
    maxMultiplier: 100000,
    minBet: 25,
    maxBet: 10000,
    targetRtp: 0.89,
    instantCrashP: 0.01,
  };
  private serverSeed: string = '';

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.loadAviatorSettings();
    await this.loadServerSeed();
  }

  /**
   * Load and cache server seed from system variables
   */
  private async loadServerSeed() {
    try {
      await this.prisma.ensureConnected();

      const systemVar = await this.prisma.system.findUnique({
        where: { key: SystemKey.AVIATOR_SERVER_SEED },
      });

      if (!systemVar) {
        // Generate a default server seed
        this.serverSeed = this.generateRandomSeed();
        await this.prisma.system.create({
          data: {
            key: SystemKey.AVIATOR_SERVER_SEED,
            value: this.serverSeed,
          },
        });
        this.logger.warn('Server seed not found, generated new one');
      } else {
        this.serverSeed = systemVar.value;
      }

      this.logger.log('Server seed loaded successfully');
    } catch (error) {
      this.logger.error('Failed to load server seed', error);
      throw new HttpException('Failed to load server seed', 500);
    }
  }

  /**
   * Load and cache AVIATOR settings from system variables
   */
  private async loadAviatorSettings() {
    try {
      await this.prisma.ensureConnected();

      const systemVar = await this.prisma.system.findUnique({
        where: { key: SystemKey.AVIATOR },
      });

      if (!systemVar) {
        this.logger.warn(
          'AVIATOR settings not found in system variables, using defaults',
        );
      } else {
        this.aviatorSettings = JSON.parse(systemVar.value);
      }

      this.logger.log('Aviator settings loaded successfully');
    } catch (error) {
      this.logger.error(
        'Failed to load aviator settings, using defaults',
        error,
      );
      throw new HttpException('Failed to load aviator settings', 500);
    }
  }

  /**
   * Reload aviator settings from database (call after admin updates)
   */
  async reloadAviatorSettings() {
    await this.loadAviatorSettings();
  }

  /**
   * Reload server seed from database (call after admin updates)
   */
  async reloadServerSeed() {
    await this.loadServerSeed();
  }

  /**
   * Get current server seed (admin only)
   */
  getServerSeed(): string {
    return this.serverSeed;
  }

  /**
   * Generate a random seed (64 hex characters)
   */
  private generateRandomSeed(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Generate client seed (32 hex characters)
   */
  generateClientSeed(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * HMAC-SHA256 hash generation
   */
  private hmacSha256Hex(key: string, message: string): string {
    return crypto.createHmac('sha256', key).update(message).digest('hex');
  }

  /**
   * Generate uniform random value from hash (0, 1)
   */
  private uniformFromHash(hexHash: string): number {
    // Take top 52 bits for precision
    const top52Hex = hexHash.substring(0, 13); // 52 bits = 13 hex chars
    const top52 = parseInt(top52Hex, 16);
    const maxValue = Math.pow(2, 52);
    return top52 / maxValue;
  }

  /**
   * Check if hash is divisible by modulus (for instant crash)
   */
  private divisible(hexHash: string, modulus: number): boolean {
    let val = 0;
    const offset = hexHash.length % 4;
    let i = offset > 0 ? offset - 4 : 0;

    while (i < hexHash.length) {
      const chunk = hexHash.substring(i, i + 4);
      val = ((val << 16) + parseInt(chunk, 16)) % modulus;
      i += 4;
    }

    return val === 0;
  }

  /**
   * Calculate crash multiplier using provably fair algorithm
   * Based on HMAC-SHA256 with server seed, client seed, and nonce
   */
  private crashRoundMultiplier(
    serverSeed: string,
    clientSeed: string,
    nonce: number,
  ): number {
    const { targetRtp, instantCrashP, minMultiplier, maxMultiplier } =
      this.aviatorSettings;

    // 1) Generate HMAC hash
    const message = `${clientSeed}:${nonce}`;
    const hexHash = this.hmacSha256Hex(serverSeed, message);

    // 2) Instant crash check with probability instantCrashP
    const instantCrashModulus = Math.max(2, Math.round(1.0 / instantCrashP));
    if (this.divisible(hexHash, instantCrashModulus)) {
      return minMultiplier; // 1.00x instant crash
    }

    // 3) Generate uniform random value and apply inverse distribution
    let U = this.uniformFromHash(hexHash);
    U = Math.max(U, 1e-12); // Protection from zero

    // Calibration coefficient
    const K = targetRtp * (1.0 - instantCrashP);
    let multiplier = K / U;

    // 4) Apply boundaries
    multiplier = Math.max(multiplier, minMultiplier);
    multiplier = Math.min(multiplier, maxMultiplier);

    // Round to 2 decimal places
    return Math.round(multiplier * 100) / 100;
  }

  /**
   * Get current aviator settings
   */
  getAviatorSettings(): AviatorSettings {
    return this.aviatorSettings;
  }

  /**
   * Create or get active aviator game
   * Only one ACTIVE game can exist at a time
   */
  async createOrGetAviator() {
    try {
      // Check if there's already an active game
      const existingGame = await this.prisma.aviator.findFirst({
        where: {
          status: AviatorStatus.ACTIVE,
        },
        orderBy: {
          createdAt: 'desc',
        },
        include: {
          bets: {
            select: {
              id: true,
              amount: true,
              cashedAt: true,
              createdAt: true,
              user: {
                select: {
                  id: true,
                  username: true,
                  telegramId: true,
                },
              },
            },
          },
        },
      });

      if (existingGame) {
        return existingGame;
      }

      // Get the latest nonce from database
      const latestGame = await this.prisma.aviator.findFirst({
        orderBy: {
          nonce: 'desc',
        },
        select: {
          nonce: true,
        },
      });

      const nonce = latestGame ? latestGame.nonce + 1 : 1;

      // Generate client seed
      const clientSeed = this.generateClientSeed();

      // Calculate multiplier using provably fair algorithm
      const multiplier = this.crashRoundMultiplier(
        this.serverSeed,
        clientSeed,
        nonce,
      );

      // Create new game with startsAt = now + 6 seconds
      const startsAt = new Date(Date.now() + 6000);

      const newGame = await this.prisma.aviator.create({
        data: {
          startsAt,
          multiplier,
          clientSeed,
          nonce,
          status: AviatorStatus.ACTIVE,
        },
        include: {
          bets: {
            select: {
              id: true,
              amount: true,
              cashedAt: true,
              createdAt: true,
              user: {
                select: {
                  id: true,
                  username: true,
                  telegramId: true,
                },
              },
            },
          },
        },
      });

      this.logger.log(
        `Created new aviator game #${newGame.id} with multiplier ${multiplier}x (nonce: ${nonce}, clientSeed: ${clientSeed}), starts at ${startsAt.toISOString()}`,
      );

      return newGame;
    } catch (error) {
      this.logger.error('Failed to create or get aviator game', error);
      throw new HttpException('Failed to create or get aviator game', 500);
    }
  }

  /**
   * Get current active game
   */
  async getCurrentGame() {
    try {
      const game = await this.prisma.aviator.findFirst({
        where: {
          status: AviatorStatus.ACTIVE,
        },
        orderBy: {
          createdAt: 'desc',
        },
        include: {
          bets: {
            select: {
              id: true,
              amount: true,
              cashedAt: true,
              createdAt: true,
              user: {
                select: {
                  id: true,
                  username: true,
                  telegramId: true,
                },
              },
            },
          },
        },
      });

      if (!game) {
        throw new HttpException('No active aviator game found', 404);
      }

      return game;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error('Failed to get current aviator game', error);
      throw new HttpException('Failed to get current aviator game', 500);
    }
  }

  /**
   * Update game status
   */
  async updateGameStatus(id: number, status: AviatorStatus) {
    try {
      const updatedGame = await this.prisma.aviator.update({
        where: { id },
        data: { status },
      });

      this.logger.log(`Updated aviator game #${id} status to ${status}`);

      return updatedGame;
    } catch (error) {
      this.logger.error(`Failed to update aviator game #${id} status`, error);
      throw new HttpException('Failed to update aviator game status', 500);
    }
  }

  /**
   * Place a bet on the current aviator game
   * Validates bet amount, checks user balance, and creates bet in atomic transaction
   */
  async placeBet(userId: string, aviatorId: number, amount: number) {
    try {
      const { minBet, maxBet } = this.aviatorSettings;

      // Validate bet amount
      if (amount < minBet) {
        throw new HttpException(`Minimum bet amount is ${minBet}`, 400);
      }
      if (amount > maxBet) {
        throw new HttpException(`Maximum bet amount is ${maxBet}`, 400);
      }

      // Get the specific aviator game
      const game = await this.prisma.aviator.findUnique({
        where: {
          id: aviatorId,
        },
      });

      if (!game) {
        throw new HttpException('Aviator game not found', 404);
      }

      // Check if game is still active
      if (game.status !== AviatorStatus.ACTIVE) {
        throw new HttpException('Game is no longer active', 400);
      }

      // Check if game has already started
      if (new Date() >= game.startsAt) {
        throw new HttpException(
          'Game has already started, cannot place bet',
          400,
        );
      }

      // Use transaction for atomicity
      const result = await this.prisma.$transaction(async (tx) => {
        // Get user with current balance
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: { id: true, balance: true, isBanned: true },
        });

        if (!user) {
          throw new HttpException('User not found', 404);
        }

        if (user.isBanned) {
          throw new HttpException('User is banned', 403);
        }

        // Check if user already has a bet on this game
        const existingBet = await tx.bet.findFirst({
          where: {
            aviatorId: game.id,
            userId: userId,
          },
        });

        if (existingBet) {
          throw new HttpException('You already have a bet on this game', 400);
        }

        // Decrement user balance with atomic check
        const updateResult = await tx.user.updateMany({
          where: {
            id: userId,
            balance: {
              gte: amount,
            },
          },
          data: {
            balance: {
              decrement: amount,
            },
          },
        });

        // If no rows were updated, balance was insufficient
        if (updateResult.count === 0) {
          throw new HttpException('Insufficient balance', 400);
        }

        // Create bet
        const bet = await tx.bet.create({
          data: {
            aviatorId: game.id,
            userId: userId,
            amount: amount,
          },
          include: {
            aviator: true,
            user: {
              select: {
                id: true,
                username: true,
                balance: true,
              },
            },
          },
        });

        return bet;
      });

      this.logger.log(
        `User ${userId} placed bet of ${amount} on aviator game #${game.id}`,
      );

      return result;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error('Failed to place bet on aviator game', error);
      throw new HttpException('Failed to place bet on aviator game', 500);
    }
  }

  /**
   * Cash out a bet at the current multiplier
   * Validates bet exists, hasn't been cashed out, and game is still active
   */
  async cashOut(userId: string, betId: number, currentMultiplier: number) {
    try {
      // Validate current multiplier
      if (currentMultiplier < 1) {
        throw new HttpException('Invalid multiplier', 400);
      }

      // Use transaction for atomicity
      const result = await this.prisma.$transaction(async (tx) => {
        // Get bet with game and user info
        const bet = await tx.bet.findUnique({
          where: { id: betId },
          include: {
            aviator: true,
            user: {
              select: {
                id: true,
                username: true,
                balance: true,
                isBanned: true,
              },
            },
          },
        });

        if (!bet) {
          throw new HttpException('Bet not found', 404);
        }

        // Check if bet belongs to the user
        if (bet.userId !== userId) {
          throw new HttpException('Unauthorized to cash out this bet', 403);
        }

        // Check if user is banned
        if (bet.user.isBanned) {
          throw new HttpException('User is banned', 403);
        }

        // Check if bet has already been cashed out
        if (bet.cashedAt !== null) {
          throw new HttpException('Bet has already been cashed out', 400);
        }

        // Check if game is still active
        if (bet.aviator.status !== AviatorStatus.ACTIVE) {
          throw new HttpException('Game is no longer active', 400);
        }

        // Check if game has started
        if (new Date() < bet.aviator.startsAt) {
          throw new HttpException('Game has not started yet', 400);
        }

        // Check if current multiplier exceeds game's final multiplier
        if (currentMultiplier > bet.aviator.multiplier.toNumber()) {
          throw new HttpException(
            'Cannot cash out after plane has crashed',
            400,
          );
        }

        // Calculate winnings
        const winAmount = Math.floor(bet.amount * currentMultiplier);

        // Update bet with cashedAt multiplier
        const updatedBet = await tx.bet.update({
          where: { id: betId },
          data: {
            cashedAt: currentMultiplier,
          },
          include: {
            user: {
              select: {
                id: true,
                username: true,
                balance: true,
              },
            },
          },
        });

        // Add winnings to user balance
        await tx.user.update({
          where: { id: userId },
          data: {
            balance: {
              increment: winAmount,
            },
          },
        });

        return {
          bet: updatedBet,
          winAmount,
          multiplier: currentMultiplier,
        };
      });

      this.logger.log(
        `User ${userId} cashed out bet #${betId} at ${currentMultiplier}x for ${result.winAmount} coins`,
      );

      return result;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error('Failed to cash out bet', error);
      throw new HttpException('Failed to cash out bet', 500);
    }
  }
}
