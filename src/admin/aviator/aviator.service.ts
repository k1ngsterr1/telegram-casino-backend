import {
  Injectable,
  Logger,
  OnModuleInit,
  HttpException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
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
    minMultiplier: 1.05,
    maxMultiplier: 100000,
    minBet: 25,
    maxBet: 10000,
    targetRtp: 0.89,
    instantCrashP: 0.01,
  };
  private serverSeed: string = '';
  private websocketGateway: any = null; // Reference to WebSocket gateway for broadcasting

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Set WebSocket gateway reference (called by gateway on init)
   */
  setWebSocketGateway(gateway: any) {
    this.websocketGateway = gateway;
    this.logger.log('✅ WebSocket gateway reference set');
  }

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
   * Only one ACTIVE or WAITING game can exist at a time
   */
  async createOrGetAviator() {
    console.log('🚀 createOrGetAviator() called');
    try {
      // Check if there's already an active or waiting game
      const existingGame = await this.prisma.aviator.findFirst({
        where: {
          status: {
            in: [AviatorStatus.WAITING, AviatorStatus.ACTIVE],
          },
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
        console.log(
          `✅ Found existing game #${existingGame.id} with status ${existingGame.status}`,
        );

        const now = Date.now();
        const gameStartTime = new Date(existingGame.startsAt).getTime();

        // If WAITING but start time already passed -> either start it or finish if too old
        if (existingGame.status === AviatorStatus.WAITING) {
          const elapsed = now - gameStartTime;
          // If it was supposed to start a while ago, consider it stale
          if (elapsed > 15_000) {
            // Stale waiting game -> finalize and create new
            console.warn(
              `⚠️ Stale WAITING game #${existingGame.id}, started at ${new Date(gameStartTime).toISOString()} (elapsed ${Math.floor(elapsed / 1000)}s). Marking FINISHED.`,
            );
            await this.prisma.aviator.update({
              where: { id: existingGame.id },
              data: { status: AviatorStatus.FINISHED },
            });
            // fall through to create new game
          } else if (elapsed >= 0) {
            // It should have started or is starting now -> start it
            console.log(
              `🚀 Starting delayed WAITING game #${existingGame.id} (elapsed ${Math.floor(elapsed / 1000)}s)`,
            );
            await this.startGame(existingGame.id);
            // reload and return started game
            const started = await this.prisma.aviator.findUnique({
              where: { id: existingGame.id },
              include: {
                bets: {
                  select: {
                    id: true,
                    amount: true,
                    cashedAt: true,
                    createdAt: true,
                    user: {
                      select: { id: true, username: true, telegramId: true },
                    },
                  },
                },
              },
            });
            return started;
          } else {
            // startsAt in the future (shouldn't happen) - return it
            return existingGame;
          }
        }

        // If ACTIVE but it's long past expected end -> finalize
        if (existingGame.status === AviatorStatus.ACTIVE) {
          const expectedEnd = gameStartTime + 30_000; // 30s max flight
          if (now > expectedEnd) {
            console.warn(
              `⚠️ ACTIVE game #${existingGame.id} is stale (started at ${new Date(gameStartTime).toISOString()}). Marking FINISHED.`,
            );
            await this.prisma.aviator.update({
              where: { id: existingGame.id },
              data: { status: AviatorStatus.FINISHED },
            });
            // fall through to create new game
          } else {
            return existingGame;
          }
        }
      }

      // No active/waiting game -> create new one
      return await this.createNewGame();
    } catch (error) {
      console.error('❌ Error in createOrGetAviator:', error);
      this.logger.error('Failed to create or get aviator game', error);
      throw new HttpException('Failed to create or get aviator game', 500);
    }
  }

  /**
   * Create a new game and schedule its auto-start
   */
  private async createNewGame() {
    try {
      console.log('📝 No active/waiting game found, creating new one...');

      // Get the latest nonce from database
      const latestGame = await this.prisma.aviator.findFirst({
        orderBy: { nonce: 'desc' },
        select: { nonce: true },
      });

      const nonce = latestGame ? latestGame.nonce + 1 : 1;
      console.log(`📊 Nonce: ${nonce}`);

      // Generate client seed
      const clientSeed = this.generateClientSeed();
      console.log(`🎲 Generated clientSeed: ${clientSeed}`);

      // Calculate multiplier using provably fair algorithm
      const multiplier = this.crashRoundMultiplier(
        this.serverSeed,
        clientSeed,
        nonce,
      );
      console.log(`🎯 Calculated multiplier: ${multiplier}x`);

      // Create new game with status WAITING and startsAt = now + 10 seconds
      const startsAt = new Date(Date.now() + 10_000);

      const newGame = await this.prisma.aviator.create({
        data: {
          startsAt,
          multiplier,
          clientSeed,
          nonce,
          status: AviatorStatus.WAITING,
        },
        include: {
          bets: {
            select: {
              id: true,
              amount: true,
              cashedAt: true,
              createdAt: true,
              user: { select: { id: true, username: true, telegramId: true } },
            },
          },
        },
      });

      console.log(
        `✅ Created new aviator game #${newGame.id} with WAITING status (startsAt: ${startsAt.toISOString()})`,
      );
      this.logger.log(
        `Created new aviator game #${newGame.id} with multiplier ${multiplier}x (nonce: ${nonce}, clientSeed: ${clientSeed}), starts at ${startsAt.toISOString()}`,
      );

      // NOTE: Auto-start scheduling is handled by WebSocket gateway
      // to ensure proper event broadcasting to all connected clients

      return newGame;
    } catch (error) {
      console.error('❌ Error in createNewGame:', error);
      throw error;
    }
  }

  /**
   * Start a WAITING game (set to ACTIVE) and schedule crash
   * NOTE: This only updates the database. WebSocket events should be emitted by the gateway.
   */
  async startGame(gameId: number) {
    try {
      this.logger.log(`🚀 [Service] Starting game #${gameId}`);

      // Update game status to ACTIVE
      const game = await this.prisma.aviator.update({
        where: { id: gameId },
        data: { status: AviatorStatus.ACTIVE, startsAt: new Date() },
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

      // Calculate crash delay for logging
      const crashDelay = this.calculateCrashDelay(Number(game.multiplier));
      this.logger.log(
        `✅ [Service] Game #${game.id} started successfully. Will crash at ${game.multiplier}x in ${Math.ceil(crashDelay / 1000)}s`,
      );

      // NOTE: Crash scheduling is handled by WebSocket gateway
      // to ensure proper event broadcasting to all connected clients

      return game;
    } catch (error) {
      this.logger.error('[Service] Failed to start game', error);
      throw error;
    }
  }

  /**
   * Crash (finish) a game: set status to FINISHED
   */
  async crashGame(gameId: number) {
    try {
      this.logger.log(`💥 Finalizing (crash) game #${gameId}`);
      const finished = await this.prisma.aviator.update({
        where: { id: gameId },
        data: { status: AviatorStatus.FINISHED },
      });

      this.logger.log(`✅ Game #${gameId} marked as FINISHED`);
      return finished;
    } catch (error) {
      this.logger.error('Failed to crash/finish game', error);
      throw error;
    }
  }

  /**
   * Calculate crash delay based on multiplier
   * SYNCHRONIZED WITH FRONTEND AND WEBSOCKET GATEWAY!
   * Formula: (multiplier - 1.0) * 5000ms
   * Example: 2.00x = 5000ms, 5.00x = 20000ms, 10.00x = 45000ms
   */
  private calculateCrashDelay(multiplier: number): number {
    // CRITICAL: This MUST match the frontend formula
    // Frontend uses: const crashTimeMs = (crashMultiplier - 1.0) * 5000;
    return Math.round((multiplier - 1.0) * 5000);
  }

  /**
   * Get current active or waiting game
   */
  async getCurrentGame() {
    try {
      const game = await this.prisma.aviator.findFirst({
        where: {
          status: {
            in: [AviatorStatus.WAITING, AviatorStatus.ACTIVE],
          },
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
        throw new HttpException('No active or waiting aviator game found', 404);
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

      // Validate bet amount is a positive number
      if (!amount || amount <= 0) {
        throw new HttpException('Bet amount must be greater than 0', 400);
      }

      // Validate bet amount range
      if (amount < minBet) {
        throw new HttpException(
          `Minimum bet amount is ${minBet}. You tried to bet ${amount}`,
          400,
        );
      }
      if (amount > maxBet) {
        throw new HttpException(
          `Maximum bet amount is ${maxBet}. You tried to bet ${amount}`,
          400,
        );
      }

      this.logger.log(
        `User ${userId} attempting to place bet of ${amount} on aviator #${aviatorId}`,
      );

      // Get the specific aviator game
      const game = await this.prisma.aviator.findUnique({
        where: {
          id: aviatorId,
        },
      });

      if (!game) {
        throw new HttpException('Aviator game not found', 404);
      }

      // Check if game is in WAITING status (bets only allowed during WAITING)
      if (game.status !== AviatorStatus.WAITING) {
        throw new HttpException('Game is not accepting bets', 400);
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

        // Check user balance BEFORE attempting bet
        const currentBalance = Number(user.balance);
        if (currentBalance < amount) {
          this.logger.warn(
            `User ${userId} attempted to bet ${amount} with insufficient balance ${currentBalance}`,
          );
          throw new HttpException(
            `Insufficient balance. You have ${currentBalance}, but need ${amount}`,
            400,
          );
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

        // Decrement user balance with atomic check (double protection)
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

        // If no rows were updated, balance was insufficient (race condition protection)
        if (updateResult.count === 0) {
          this.logger.error(
            `Race condition: User ${userId} balance changed during transaction`,
          );
          throw new HttpException(
            'Insufficient balance. Your balance may have changed.',
            400,
          );
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
   * NOW WITH SERVER-SIDE MULTIPLIER VALIDATION
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

        // SERVER-SIDE MULTIPLIER VALIDATION
        // Calculate what the multiplier SHOULD be on the server
        const now = Date.now();
        const startTime = new Date(bet.aviator.startsAt).getTime();
        const elapsed = now - startTime;
        const crashPoint = Number(bet.aviator.multiplier);
        const crashTimeMs = (crashPoint - 1.0) * 5000; // Same formula as frontend

        // Check if game already crashed
        if (elapsed >= crashTimeMs) {
          this.logger.warn(
            `User ${userId} tried to cashout after crash. Elapsed: ${elapsed}ms, crashTime: ${crashTimeMs}ms`,
          );
          throw new HttpException(
            'Cannot cash out after plane has crashed',
            400,
          );
        }

        // Calculate server's current multiplier
        const progress = elapsed / crashTimeMs;
        const serverMultiplier = 1.0 + (crashPoint - 1.0) * progress;

        // Check if client multiplier is reasonable (allow 10% deviation for network delay)
        const deviation =
          Math.abs(currentMultiplier - serverMultiplier) / serverMultiplier;

        if (deviation > 0.15) {
          this.logger.warn(
            `User ${userId} multiplier deviation: client=${currentMultiplier.toFixed(2)}, server=${serverMultiplier.toFixed(2)}, deviation=${(deviation * 100).toFixed(1)}%`,
          );
          // Use server multiplier instead
          currentMultiplier = Number(serverMultiplier.toFixed(2));
        }

        // Check if current multiplier exceeds game's final multiplier
        if (currentMultiplier > crashPoint) {
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

  /**
   * Deposit inventory item into aviator game
   * Deletes inventory item and creates bet in one transaction
   */
  async depositInventoryItem(
    userId: string,
    inventoryItemId: number,
    aviatorId: number,
  ) {
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        // 1. Get and validate inventory item
        const inventoryItem = await tx.inventoryItem.findUnique({
          where: { id: inventoryItemId },
          include: {
            prize: true,
          },
        });

        if (!inventoryItem) {
          throw new HttpException('Inventory item not found', 404);
        }

        if (inventoryItem.userId !== userId) {
          throw new HttpException('You do not own this item', 403);
        }

        // 2. Validate aviator game exists and is active
        const game = await tx.aviator.findUnique({
          where: { id: aviatorId },
        });

        if (!game) {
          throw new HttpException('Aviator game not found', 404);
        }

        if (game.status !== AviatorStatus.WAITING) {
          throw new HttpException('Game is not accepting bets', 400);
        }

        // Check if game has already started
        if (new Date() >= game.startsAt) {
          throw new HttpException(
            'Game has already started, cannot place bet',
            400,
          );
        }

        // 3. Check if user already has an inventory bet on this game
        const existingBet = await tx.bet.findFirst({
          where: {
            aviatorId: aviatorId,
            userId: userId,
            isInventoryBet: true,
          },
        });

        if (existingBet) {
          throw new HttpException(
            'You already have an inventory bet on this game',
            400,
          );
        }

        // 4. Delete inventory item
        await tx.inventoryItem.delete({
          where: { id: inventoryItemId },
        });

        // 5. Create bet with inventory flag
        const bet = await tx.bet.create({
          data: {
            aviatorId: aviatorId,
            userId: userId,
            amount: inventoryItem.prize.amount,
            isInventoryBet: true,
          },
        });

        return {
          bet,
          depositedItem: inventoryItem.prize,
        };
      });

      this.logger.log(
        `User ${userId} deposited inventory item #${inventoryItemId} into aviator game #${aviatorId}`,
      );

      return {
        betId: result.bet.id,
        aviatorId: result.bet.aviatorId,
        initialAmount: result.bet.amount,
        depositedItem: {
          id: result.depositedItem.id,
          name: result.depositedItem.name,
          amount: result.depositedItem.amount,
          url: result.depositedItem.url,
        },
        createdAt: result.bet.createdAt,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error('Failed to deposit inventory item', error);
      throw new HttpException('Failed to deposit inventory item', 500);
    }
  }

  /**
   * Get possible prize for current amount (fast lookup)
   * Returns random prize with amount >= currentAmount
   */
  async getPossiblePrize(currentAmount: number) {
    try {
      // Find all prizes with amount >= currentAmount
      const eligiblePrizes = await this.prisma.prize.findMany({
        where: {
          amount: {
            gte: currentAmount,
          },
        },
        orderBy: {
          amount: 'asc',
        },
        take: 5, // Take top 5 closest prizes for random selection
      });

      if (eligiblePrizes.length === 0) {
        throw new HttpException('No prize available for this amount', 404);
      }

      // Select random prize from eligible prizes
      const randomIndex = Math.floor(Math.random() * eligiblePrizes.length);
      const selectedPrize = eligiblePrizes[randomIndex];

      return {
        id: selectedPrize.id,
        name: selectedPrize.name,
        amount: selectedPrize.amount,
        url: selectedPrize.url,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error('Failed to get possible prize', error);
      throw new HttpException('Failed to get possible prize', 500);
    }
  }

  /**
   * Cash out gift - give user the prize based on current multiplier
   */
  async cashoutGift(userId: string, betId: number, currentMultiplier: number) {
    try {
      if (currentMultiplier < 1) {
        throw new HttpException('Invalid multiplier', 400);
      }

      const result = await this.prisma.$transaction(async (tx) => {
        // 1. Get and validate bet
        const bet = await tx.bet.findUnique({
          where: { id: betId },
          include: {
            aviator: true,
          },
        });

        if (!bet) {
          throw new HttpException('Bet not found', 404);
        }

        if (bet.userId !== userId) {
          throw new HttpException('Unauthorized to cash out this bet', 403);
        }

        if (!bet.isInventoryBet) {
          throw new HttpException('This is not an inventory bet', 400);
        }

        if (bet.cashedAt !== null) {
          throw new HttpException('Bet has already been cashed out', 400);
        }

        if (bet.aviator.status !== 'ACTIVE') {
          throw new HttpException('Game is no longer active', 400);
        }

        if (new Date() < bet.aviator.startsAt) {
          throw new HttpException('Game has not started yet', 400);
        }

        if (currentMultiplier > Number(bet.aviator.multiplier)) {
          throw new HttpException(
            'Cannot cash out after plane has crashed',
            400,
          );
        }

        // 2. Calculate final amount
        const finalAmount = Math.floor(bet.amount * currentMultiplier);

        // 3. Find prize with amount >= finalAmount
        const eligiblePrizes = await tx.prize.findMany({
          where: {
            amount: {
              gte: finalAmount,
            },
          },
          orderBy: {
            amount: 'asc',
          },
          take: 10,
        });

        if (eligiblePrizes.length === 0) {
          throw new HttpException('No prize available for this amount', 404);
        }

        // Select random prize
        const randomIndex = Math.floor(Math.random() * eligiblePrizes.length);
        const selectedPrize = eligiblePrizes[randomIndex];

        // 4. Update bet with cash out info and prize
        await tx.bet.update({
          where: { id: betId },
          data: {
            cashedAt: currentMultiplier,
            prizeId: selectedPrize.id,
          },
        });

        // 5. Add prize to user's inventory
        const newInventoryItem = await tx.inventoryItem.create({
          data: {
            userId: userId,
            prizeId: selectedPrize.id,
          },
        });

        return {
          bet,
          prize: selectedPrize,
          finalAmount,
          newInventoryItemId: newInventoryItem.id,
        };
      });

      this.logger.log(
        `User ${userId} cashed out inventory bet #${betId} at ${currentMultiplier}x for prize #${result.prize.id}`,
      );

      return {
        betId: result.bet.id,
        cashedAt: currentMultiplier,
        initialAmount: result.bet.amount,
        finalAmount: result.finalAmount,
        prize: {
          id: result.prize.id,
          name: result.prize.name,
          amount: result.prize.amount,
          url: result.prize.url,
        },
        newInventoryItemId: result.newInventoryItemId,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error('Failed to cash out gift', error);
      throw new HttpException('Failed to cash out gift', 500);
    }
  }

  /**
   * Get game history (last N finished games)
   */
  async getGameHistory(limit: number = 20) {
    try {
      const games = await this.prisma.aviator.findMany({
        where: {
          status: AviatorStatus.FINISHED,
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: limit,
        select: {
          id: true,
          multiplier: true,
          clientSeed: true,
          nonce: true,
          status: true,
          startsAt: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              bets: true,
            },
          },
        },
      });

      return games.map((game) => ({
        ...game,
        multiplier: Number(game.multiplier),
        totalBets: game._count.bets,
      }));
    } catch (error) {
      this.logger.error('Failed to get game history', error);
      throw new HttpException('Failed to get game history', 500);
    }
  }

  /**
   * Auto-start WAITING games that should have started - runs every 5 seconds
   * CRITICAL: This ensures games always start even if setTimeout fails
   */
  @Cron('*/5 * * * * *') // Every 5 seconds
  async autoStartWaitingGames() {
    try {
      const now = new Date();

      // Find WAITING games that should have started (startsAt is in the past)
      const stalledGames = await this.prisma.aviator.findMany({
        where: {
          status: AviatorStatus.WAITING,
          startsAt: {
            lt: now, // startsAt is before now
          },
        },
        include: {
          bets: {
            select: {
              id: true,
              amount: true,
              cashedAt: true,
              createdAt: true,
              user: {
                select: { id: true, username: true, telegramId: true },
              },
            },
          },
        },
      });

      for (const game of stalledGames) {
        const elapsed = now.getTime() - new Date(game.startsAt).getTime();

        // If game is less than 15 seconds overdue, start it
        if (elapsed < 15_000) {
          this.logger.warn(
            `⚠️ [CRON] Game #${game.id} should have started ${Math.floor(elapsed / 1000)}s ago. Starting NOW!`,
          );

          // Start the game (updates database)
          const startedGame = await this.startGame(game.id);

          // Broadcast to all clients if gateway is available
          if (this.websocketGateway && this.websocketGateway.server) {
            // Emit status change
            this.websocketGateway.server.emit('aviator:statusChange', {
              gameId: startedGame.id,
              status: 'ACTIVE',
              timestamp: new Date().toISOString(),
            });

            // Broadcast game state
            const response = {
              ...startedGame,
              multiplier: Number(startedGame.multiplier),
              bets: (startedGame.bets || []).map((bet) => ({
                ...bet,
                amount: Number(bet.amount),
                cashedAt: bet.cashedAt ? Number(bet.cashedAt) : null,
              })),
            };
            this.websocketGateway.server.emit('aviator:game', response);

            this.logger.log(
              `✅ [CRON] Broadcasted game #${startedGame.id} start to all clients`,
            );

            // Notify gateway to schedule crash
            if (this.websocketGateway.handleGameStartedByCron) {
              this.websocketGateway.handleGameStartedByCron(startedGame);
            }
          }
        } else {
          // If game is more than 15 seconds overdue, it's too stale - mark as FINISHED
          this.logger.warn(
            `⚠️ [CRON] Game #${game.id} is ${Math.floor(elapsed / 1000)}s overdue. Marking as FINISHED.`,
          );
          await this.prisma.aviator.update({
            where: { id: game.id },
            data: { status: AviatorStatus.FINISHED },
          });
        }
      }
    } catch (error) {
      this.logger.error('[CRON] Failed to auto-start waiting games', error);
    }
  }

  /**
   * Cleanup stale games - runs every 30 seconds
   * Finishes WAITING games older than 15 seconds
   * Finishes ACTIVE games older than 30 seconds
   */
  @Cron(CronExpression.EVERY_30_SECONDS)
  async cleanupStaleGames() {
    try {
      const now = new Date();
      const fifteenSecondsAgo = new Date(now.getTime() - 15000);
      const thirtySecondsAgo = new Date(now.getTime() - 30000);

      // Finish WAITING games older than 15 seconds
      const staleWaitingGames = await this.prisma.aviator.updateMany({
        where: {
          status: AviatorStatus.WAITING,
          startsAt: {
            lt: fifteenSecondsAgo,
          },
        },
        data: {
          status: AviatorStatus.FINISHED,
        },
      });

      if (staleWaitingGames.count > 0) {
        this.logger.warn(
          `🧹 Cleaned up ${staleWaitingGames.count} stale WAITING games`,
        );
      }

      // Finish ACTIVE games older than 30 seconds
      const staleActiveGames = await this.prisma.aviator.updateMany({
        where: {
          status: AviatorStatus.ACTIVE,
          startsAt: {
            lt: thirtySecondsAgo,
          },
        },
        data: {
          status: AviatorStatus.FINISHED,
        },
      });

      if (staleActiveGames.count > 0) {
        this.logger.warn(
          `🧹 Cleaned up ${staleActiveGames.count} stale ACTIVE games`,
        );
      }
    } catch (error) {
      this.logger.error('Failed to cleanup stale games', error);
    }
  }
}
