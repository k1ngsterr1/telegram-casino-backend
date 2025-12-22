import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import {
  Logger,
  UseGuards,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../shared/services/prisma.service';
import { AviatorService } from '../admin/aviator/aviator.service';
import { CaseService } from '../case/case.service';
import { WsJwtGuard } from './guards/ws-jwt.guard';

@WebSocketGateway({
  cors: {
    origin: ['https://easycase.online'],
    credentials: true,
  },
  namespace: '/ws',
})
export class WebsocketGateway
  implements
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleInit,
    OnModuleDestroy
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(WebsocketGateway.name);
  private activeUsers: Map<string, string> = new Map(); // userId -> socket ID (only one connection per user)
  private gameLoopInterval: NodeJS.Timeout | null = null; // Interval for game loop
  private currentGameId: number | null = null; // Current game ID being tracked
  private crashHistory: number[] = []; // История последних крашей (массив множителей)
  private readonly MAX_CRASH_HISTORY = 20; // Максимум 20 последних крашей
  private gameStartTimeout: NodeJS.Timeout | null = null; // Timeout for auto-start
  private gameCrashTimeout: NodeJS.Timeout | null = null; // Timeout for auto-crash
  private multiplierTickInterval: NodeJS.Timeout | null = null; // Interval for multiplier ticks
  private currentGameStartTime: number | null = null; // Game start timestamp for multiplier calculation
  private initialPrizes: any[] = []; // Initial fake prizes for animation
  private prizeGenerationInterval: NodeJS.Timeout | null = null; // Interval for fake prize generation

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly aviatorService: AviatorService,
    private readonly caseService: CaseService,
  ) {}

  /**
   * Initialize game loop when module starts
   */
  async onModuleInit() {
    this.logger.log('🎮 Starting aviator game loop...');

    // Set gateway reference in aviator service for cron jobs
    this.aviatorService.setWebSocketGateway(this);

    // Set gateway reference in case service for prize broadcasts
    this.caseService.setWebSocketGateway(this);

    await this.startGameLoop();
    this.logger.log('✅ Aviator game loop initialized successfully');

    // Initialize fake prize generation for case openings
    await this.startPrizeGeneration();
    this.logger.log('✅ Prize generation initialized successfully');
  }

  /**
   * Cleanup when module destroys
   */
  onModuleDestroy() {
    if (this.gameLoopInterval) {
      clearInterval(this.gameLoopInterval);
      this.logger.log('🛑 Game loop stopped');
    }
    if (this.gameStartTimeout) {
      clearTimeout(this.gameStartTimeout);
    }
    if (this.gameCrashTimeout) {
      clearTimeout(this.gameCrashTimeout);
    }
    if (this.prizeGenerationInterval) {
      clearInterval(this.prizeGenerationInterval);
      this.logger.log('🛑 Prize generation stopped');
    }
  }

  /**
   * Start the automatic game loop
   * WAITING (5s) → ACTIVE (game duration) → FINISHED → new WAITING
   */
  private async startGameLoop() {
    try {
      // Загружаем историю крашей из базы данных
      await this.loadCrashHistory();

      // Create or get initial game
      const game = await this.aviatorService.createOrGetAviator();
      this.currentGameId = game.id;
      this.logger.log(
        `🎮 Initial game #${game.id} created with status ${game.status}`,
      );

      // Broadcast initial game state
      this.broadcastGameState(game);

      // Schedule auto-start for new game
      const timeUntilStart = new Date(game.startsAt).getTime() - Date.now();
      if (timeUntilStart > 0) {
        this.logger.log(
          `⏰ Scheduling game #${game.id} to start in ${Math.ceil(timeUntilStart / 1000)}s`,
        );
        this.gameStartTimeout = setTimeout(() => {
          this.startGame(game.id);
        }, timeUntilStart);
      }

      // Schedule auto-start if game is WAITING
      if (game.status === 'WAITING') {
        const timeUntilStart = new Date(game.startsAt).getTime() - Date.now();
        if (timeUntilStart > 0) {
          this.logger.log(
            `⏰ Scheduling game #${game.id} to start in ${Math.ceil(timeUntilStart / 1000)}s`,
          );
          this.gameStartTimeout = setTimeout(() => {
            this.startGame(game.id);
          }, timeUntilStart);
        } else {
          // Game should have started already
          this.logger.log(
            `🚀 Game #${game.id} start time passed, starting immediately`,
          );
          this.startGame(game.id);
        }
      }

      this.logger.log(
        `✅ Game loop started successfully. Monitoring game #${game.id}`,
      );
    } catch (error) {
      this.logger.error('Failed to start game loop', error);
    }
  }

  /**
   * Load crash history from database (last 20 finished games)
   */
  private async loadCrashHistory() {
    try {
      const finishedGames = await this.prisma.aviator.findMany({
        where: {
          status: 'FINISHED',
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: this.MAX_CRASH_HISTORY,
        select: {
          multiplier: true,
        },
      });

      this.crashHistory = finishedGames.map((game) => Number(game.multiplier));

      this.logger.log(
        `📊 Loaded ${this.crashHistory.length} crashes from database: [${this.crashHistory.slice(0, 5).join(', ')}...]`,
      );
    } catch (error) {
      this.logger.error('Failed to load crash history', error);
      this.crashHistory = [];
    }
  }

  /**
   * Start generating fake prizes every 3-8 seconds
   */
  private async startPrizeGeneration() {
    try {
      // Generate initial batch of fake prizes (last 20)
      await this.generateInitialPrizes();

      // Start periodic fake prize generation (every 3-8 seconds)
      const generateFakePrize = async () => {
        try {
          const fakePrize = await this.generateFakePrize();
          this.broadcastPrizeWon(fakePrize);

          // Schedule next fake prize (random interval 3-8 seconds)
          const nextInterval = 3000 + Math.random() * 5000;
          setTimeout(generateFakePrize, nextInterval);
        } catch (error) {
          this.logger.error('Failed to generate fake prize', error);
          // Retry after 5 seconds
          setTimeout(generateFakePrize, 5000);
        }
      };

      // Start first fake prize generation
      const firstInterval = 3000 + Math.random() * 5000;
      setTimeout(generateFakePrize, firstInterval);

      this.logger.log('✅ Started fake prize generation');
    } catch (error) {
      this.logger.error('Failed to start prize generation', error);
    }
  }

  /**
   * Generate initial batch of fake prizes (last 20)
   */
  private async generateInitialPrizes() {
    try {
      const prizes = [];
      for (let i = 0; i < 20; i++) {
        prizes.push(await this.generateFakePrize());
      }
      this.initialPrizes = prizes;
      this.logger.log(`📊 Generated ${prizes.length} initial fake prizes`);
    } catch (error) {
      this.logger.error('Failed to generate initial prizes', error);
      this.initialPrizes = [];
    }
  }

  /**
   * Generate a single fake prize
   */
  private async generateFakePrize() {
    try {
      // Get random case
      const cases = await this.prisma.case.findMany({
        select: { id: true, name: true },
      });

      if (!cases || cases.length === 0) {
        throw new Error('No cases found');
      }

      const randomCase = cases[Math.floor(Math.random() * cases.length)];

      // Get random prize from that case
      const caseItems = await this.prisma.caseItem.findMany({
        where: { caseId: randomCase.id },
        include: { prize: true },
      });

      if (!caseItems || caseItems.length === 0) {
        throw new Error('No items found in case');
      }

      const randomItem =
        caseItems[Math.floor(Math.random() * caseItems.length)];

      // Get random username (fake)
      const fakeUsernames = [
        'Player1',
        'Lucky777',
        'Winner',
        'ProGamer',
        'CasinoKing',
        'MegaWin',
        'JackpotHunter',
        'SpinMaster',
        'FortuneSeeker',
        'GoldRush',
        'DiamondHands',
        'RocketMan',
        'MoonShot',
        'BigWinner',
        'ChampionX',
      ];
      const randomUsername =
        fakeUsernames[Math.floor(Math.random() * fakeUsernames.length)];

      return {
        username: randomUsername,
        caseName: randomCase.name,
        prizeName: randomItem.prize.name,
        prizeAmount: randomItem.prize.amount,
        prizeUrl: randomItem.prize.url,
        timestamp: new Date().toISOString(),
        isFake: true,
      };
    } catch (error) {
      this.logger.error('Failed to generate fake prize', error);
      // Return a fallback fake prize
      return {
        username: 'Player1',
        caseName: 'Mystery Box',
        prizeName: 'Coins',
        prizeAmount: 100,
        prizeUrl: 'https://nft.fragment.com/gift/PetSnake-151667.lottie.json',
        timestamp: new Date().toISOString(),
        isFake: true,
      };
    }
  }

  /**
   * Handler for when cron job starts a game
   * Schedules crash and multiplier ticks
   */
  handleGameStartedByCron(game: any) {
    try {
      this.logger.log(`🎮 [Gateway] Handling cron-started game #${game.id}`);

      // Store game start time for multiplier calculation
      this.currentGameStartTime = Date.now();
      this.currentGameId = game.id;

      // Calculate crash time based on multiplier
      const crashMultiplier = Number(game.multiplier);
      const MIN_CRASH_TIME_MS = 2000; // Minimum 2 seconds to prevent instant crashes
      const calculatedCrashTime = (crashMultiplier - 1.0) * 5000; // 5 seconds per 1.0x
      const crashTimeMs = Math.max(MIN_CRASH_TIME_MS, calculatedCrashTime); // Apply minimum

      this.logger.log(
        `💥 [Gateway] Game #${game.id} will crash at ${crashMultiplier}x in ${Math.ceil(crashTimeMs / 1000)}s`,
      );

      // Start multiplier tick broadcast (every 50ms for smooth animation)
      this.startMultiplierTicks(game.id, crashMultiplier, crashTimeMs);

      // Schedule crash
      this.gameCrashTimeout = setTimeout(() => {
        this.logger.log(
          `⏰ [Gateway] ⚡ CRASH TIMEOUT TRIGGERED (cron-started) for game #${game.id} after ${crashTimeMs}ms`,
        );
        this.crashGame(game.id).catch((err) =>
          this.logger.error('[Gateway] Failed to crash cron-started game', err),
        );
      }, crashTimeMs);

      this.logger.log(
        `⏰ [Gateway] Crash scheduled in ${crashTimeMs}ms (${Math.ceil(crashTimeMs / 1000)}s) at ${crashMultiplier}x`,
      );
    } catch (error) {
      this.logger.error(`[Gateway] Error handling cron-started game:`, error);
    }
  }

  /**
   * Start the game - transition from WAITING to ACTIVE
   */
  private async startGame(gameId: number) {
    try {
      this.logger.log(`🚀 [Gateway] ===== STARTING GAME #${gameId} =====`);

      // Update game status to ACTIVE using service
      const game = await this.aviatorService.startGame(gameId);

      if (!game) {
        this.logger.error(`[Gateway] ❌ Game #${gameId} not found after start`);
        return;
      }

      this.logger.log(
        `✅ [Gateway] Game #${gameId} status updated to ACTIVE (${game.bets.length} bets placed)`,
      );

      // Emit status change
      this.server.emit('aviator:statusChange', {
        gameId: game.id,
        status: 'ACTIVE',
        timestamp: new Date().toISOString(),
      });

      this.logger.log(
        `📡 [Gateway] Broadcasted aviator:statusChange (ACTIVE) event`,
      );

      // Broadcast game state
      this.broadcastGameState(game);

      // Store game start time for multiplier calculation
      this.currentGameStartTime = Date.now();

      // Calculate crash time based on multiplier
      const crashMultiplier = Number(game.multiplier);
      const MIN_CRASH_TIME_MS = 2000; // Minimum 2 seconds to prevent instant crashes
      const calculatedCrashTime = (crashMultiplier - 1.0) * 5000; // 5 seconds per 1.0x
      const crashTimeMs = Math.max(MIN_CRASH_TIME_MS, calculatedCrashTime); // Apply minimum

      this.logger.log(
        `💥 [Gateway] Game #${gameId} will crash at ${crashMultiplier}x in ${Math.ceil(crashTimeMs / 1000)}s (${crashTimeMs}ms)`,
      );

      // Start multiplier tick broadcast (every 50ms for smooth animation)
      this.startMultiplierTicks(game.id, crashMultiplier, crashTimeMs);

      // Schedule crash
      this.gameCrashTimeout = setTimeout(() => {
        this.logger.log(
          `⏰ [Gateway] ⚡ CRASH TIMEOUT TRIGGERED for game #${gameId} after ${crashTimeMs}ms`,
        );
        this.crashGame(gameId).catch((err) =>
          this.logger.error(
            `[Gateway] ❌ Failed to crash game #${gameId}:`,
            err,
          ),
        );
      }, crashTimeMs);

      this.logger.log(
        `✅ [Gateway] ===== GAME #${gameId} STARTED SUCCESSFULLY =====`,
      );
      this.logger.log(
        `⏰ [Gateway] Crash scheduled in ${crashTimeMs}ms (${Math.ceil(crashTimeMs / 1000)}s) at ${crashMultiplier}x`,
      );
    } catch (error) {
      this.logger.error(`[Gateway] ❌ Error starting game #${gameId}:`, error);
    }
  }

  /**
   * Start broadcasting multiplier ticks every 50ms
   */
  private startMultiplierTicks(
    gameId: number,
    crashMultiplier: number,
    crashTimeMs: number,
  ) {
    // Clear any existing interval
    if (this.multiplierTickInterval) {
      clearInterval(this.multiplierTickInterval);
    }

    const startTime = this.currentGameStartTime;
    if (!startTime) {
      this.logger.error('Game start time not set');
      return;
    }

    // Broadcast current multiplier every 50ms
    this.multiplierTickInterval = setInterval(() => {
      const elapsed = Date.now() - startTime;

      // Check if game should crash
      if (elapsed >= crashTimeMs) {
        // Stop ticks
        if (this.multiplierTickInterval) {
          clearInterval(this.multiplierTickInterval);
          this.multiplierTickInterval = null;
        }
        return;
      }

      // Calculate current multiplier
      const progress = elapsed / crashTimeMs;
      const currentMultiplier = 1.0 + (crashMultiplier - 1.0) * progress;

      // Broadcast tick to all clients
      this.server.emit('aviator:multiplierTick', {
        gameId,
        currentMultiplier: Number(currentMultiplier.toFixed(2)),
        elapsed,
        timestamp: Date.now(),
      });
    }, 50); // 50ms = 20 ticks per second

    this.logger.log(`🎯 Started multiplier ticks for game #${gameId}`);
  }

  /**
   * Stop multiplier ticks
   */
  private stopMultiplierTicks() {
    if (this.multiplierTickInterval) {
      clearInterval(this.multiplierTickInterval);
      this.multiplierTickInterval = null;
      this.logger.log('⏹️ Stopped multiplier ticks');
    }
  }

  /**
   * Broadcast current game state to all clients
   */
  private broadcastGameState(game: any) {
    try {
      if (!game) {
        this.logger.warn('Cannot broadcast game state: game is null/undefined');
        return;
      }

      const response = {
        ...game,
        multiplier: Number(game.multiplier),
        bets: (game.bets || []).map((bet) => ({
          ...bet,
          amount: Number(bet.amount),
          cashedAt: bet.cashedAt ? Number(bet.cashedAt) : null,
        })),
      };

      this.server.emit('aviator:game', response);
    } catch (error) {
      this.logger.error(
        `Error broadcasting game state: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * Crash the game - transition from ACTIVE to FINISHED
   */
  private async crashGame(gameId: number) {
    try {
      this.logger.log(`💥 [Gateway] ===== CRASHING GAME #${gameId} =====`);

      // Stop multiplier ticks
      this.stopMultiplierTicks();

      // Get game with bets before updating
      const game = await this.prisma.aviator.findUnique({
        where: { id: gameId },
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
        this.logger.error(`[Gateway] ❌ Game #${gameId} not found for crash`);
        return;
      }

      if (game.status !== 'ACTIVE') {
        this.logger.warn(
          `[Gateway] ⚠️ Game #${gameId} is not ACTIVE (status: ${game.status}), skipping crash`,
        );
        return;
      }

      // Update game status to FINISHED
      await this.aviatorService.updateGameStatus(gameId, 'FINISHED' as any);

      const crashMultiplier = Number(game.multiplier);

      this.logger.log(
        `💥 [Gateway] Game #${gameId} crashed at ${crashMultiplier}x (${game.bets.length} bets)`,
      );

      // Clear game start time
      this.currentGameStartTime = null;

      // Add to crash history
      this.addToCrashHistory(crashMultiplier);

      // Emit crashed event
      const crashEvent = {
        gameId: game.id,
        multiplier: crashMultiplier,
        timestamp: new Date().toISOString(),
      };

      this.logger.log(
        `📡 [Gateway] EMITTING aviator:crashed event: ${JSON.stringify(crashEvent)}`,
      );

      this.server.emit('aviator:crashed', crashEvent);

      // Get connected clients count safely
      const connectedClientsCount =
        this.server.sockets?.sockets?.size ||
        this.activeUsers.size ||
        'unknown';

      this.logger.log(
        `✅ [Gateway] aviator:crashed event SENT to ${connectedClientsCount} connected clients`,
      );

      // Process game results (send win/lose events)
      await this.processGameResults(game);

      // Broadcast crash history
      this.broadcastCrashHistory();

      // Emit status change
      this.server.emit('aviator:statusChange', {
        gameId: game.id,
        status: 'FINISHED',
        timestamp: new Date().toISOString(),
      });

      this.logger.log(
        `📡 [Gateway] Broadcasted aviator:statusChange (FINISHED) event`,
      );
      this.logger.log(
        `✅ [Gateway] Game #${gameId} fully processed. Creating new game in 3s...`,
      );

      // Create new game after 3 seconds with retry logic
      setTimeout(async () => {
        this.logger.log(
          `🔄 [Gateway] ===== CREATING NEW GAME AFTER CRASH =====`,
        );
        let attempts = 0;
        const maxAttempts = 3;

        while (attempts < maxAttempts) {
          try {
            this.logger.log(
              `📝 [Gateway] Creating new game after crash (attempt ${attempts + 1}/${maxAttempts})...`,
            );

            const newGame = await this.aviatorService.createOrGetAviator();
            this.currentGameId = newGame.id;

            this.logger.log(
              `🆕 [Gateway] New game #${newGame.id} created successfully with status ${newGame.status}, startsAt: ${new Date(newGame.startsAt).toISOString()}`,
            );

            // 🚨 IMPORTANT: Join ALL connected clients to the new game room
            const newGameRoom = `aviator-game-${newGame.id}`;
            const connectedSockets = await this.server.fetchSockets();

            this.logger.log(
              `🚪 [Gateway] Joining ${connectedSockets.length} connected clients to new game room: ${newGameRoom}`,
            );

            for (const socket of connectedSockets) {
              socket.join(newGameRoom);
            }

            this.logger.log(
              `✅ [Gateway] All clients joined game room: ${newGameRoom}`,
            );

            // Broadcast new game state
            this.broadcastGameState(newGame);
            this.logger.log(
              `📡 [Gateway] Broadcasted new game state to all clients`,
            );

            // Schedule auto-start for new game
            const timeUntilStart =
              new Date(newGame.startsAt).getTime() - Date.now();
            if (timeUntilStart > 0) {
              this.logger.log(
                `⏰ [Gateway] Scheduling game #${newGame.id} to start in ${Math.ceil(timeUntilStart / 1000)}s`,
              );
              this.gameStartTimeout = setTimeout(() => {
                this.logger.log(
                  `⏰ [Gateway] Auto-start timeout triggered for game #${newGame.id}`,
                );
                this.startGame(newGame.id).catch((err) =>
                  this.logger.error('[Gateway] Failed to auto-start game', err),
                );
              }, timeUntilStart);
            } else {
              // If start time already passed, start immediately
              this.logger.warn(
                `⚠️ [Gateway] Start time already passed, starting game #${newGame.id} immediately`,
              );
              await this.startGame(newGame.id);
            }

            this.logger.log(`✅ [Gateway] ===== NEW GAME CYCLE COMPLETE =====`);
            break; // Success - exit retry loop
          } catch (error) {
            attempts++;
            this.logger.error(
              `❌ [Gateway] Failed to create new game (attempt ${attempts}/${maxAttempts}):`,
              error,
            );

            if (attempts >= maxAttempts) {
              // CRITICAL ERROR - notify all clients
              this.logger.error(
                '🚨 CRITICAL: Failed to create new game after 3 attempts!',
              );

              // Broadcast error to all clients
              this.server.emit('error', {
                message: 'Failed to start new game. Please refresh the page.',
                code: 'GAME_CREATION_FAILED',
                timestamp: new Date().toISOString(),
              });

              // TODO: Send alert to monitoring/admin system
              // await this.notifyAdmin('Critical: Game creation failed after 3 attempts');
            } else {
              // Wait 2 seconds before retry
              this.logger.log(`⏳ Retrying in 2 seconds...`);
              await new Promise((resolve) => setTimeout(resolve, 2000));
            }
          }
        }
      }, 3000);
    } catch (error) {
      this.logger.error(`Error crashing game #${gameId}:`, error);
    }
  }

  /**
   * Process game results - send win/lose events to all players
   */
  private async processGameResults(game: any) {
    try {
      const crashMultiplier = Number(game.multiplier);

      this.logger.log(
        `🎲 [Gateway] Processing game results for ${game.bets?.length || 0} bets at ${crashMultiplier}x`,
      );

      if (!game.bets || game.bets.length === 0) {
        this.logger.log(
          '📝 [Gateway] No bets in game, skipping results processing',
        );
        return;
      }

      for (const bet of game.bets) {
        try {
          const userId = bet.user?.id;
          const username = bet.user?.username || 'Unknown';

          if (!userId) {
            this.logger.warn(
              `⚠️ [Gateway] Bet #${bet.id} has no user ID, skipping`,
            );
            continue;
          }

          const socketId = this.activeUsers.get(userId);
          const betAmount = Number(bet.amount);
          const cashedAt = bet.cashedAt ? Number(bet.cashedAt) : null;

          this.logger.log(
            `🎯 [Gateway] Processing bet #${bet.id} for user ${username} (${userId})`,
          );
          this.logger.log(`   - Bet Amount: ${betAmount}`);
          this.logger.log(
            `   - Cashed At: ${cashedAt !== null ? `${cashedAt}x` : 'NULL (NOT CASHED OUT)'}`,
          );
          this.logger.log(
            `   - Socket ID: ${socketId || 'NOT IN activeUsers MAP'}`,
          );
          this.logger.log(
            `   - Active Users Map Size: ${this.activeUsers.size}`,
          );

          // Player won if they cashed out
          if (cashedAt !== null) {
            const winAmount = Math.floor(betAmount * cashedAt);
            const winEvent = {
              betId: bet.id,
              betAmount: betAmount,
              cashedAt: cashedAt,
              winAmount: winAmount,
              crashMultiplier: crashMultiplier,
              timestamp: new Date().toISOString(),
            };

            this.logger.log(
              `📤 [Gateway] EMITTING aviator:win to ${username}: ${JSON.stringify(winEvent)}`,
            );

            // Send to specific user if connected
            // Try TWO methods: room-based (primary) and direct socket (fallback)
            this.logger.log(
              `📤 [Gateway] Attempting to send win event via room: ${userId}`,
            );

            // Method 1: Send via personal room (RECOMMENDED - more reliable)
            this.server.to(userId).emit('aviator:win', winEvent);
            this.logger.log(
              `✅ [Gateway] WIN event sent via room to ${username}`,
            );

            // Method 2: Also try direct socket send as fallback
            if (socketId) {
              const socket = this.getSocketById(socketId);
              if (socket) {
                socket.emit('aviator:win', winEvent);
                this.logger.log(
                  `✅ [Gateway] WIN event also sent via direct socket to ${username}`,
                );
              } else {
                this.logger.warn(
                  `⚠️ [Gateway] Socket ${socketId} not found for fallback send to ${username}`,
                );
              }
            } else {
              this.logger.warn(
                `⚠️ [Gateway] User ${username} not in activeUsers map, relied on room-based send`,
              );
            }

            this.logger.log(
              `✅ [Gateway] WIN event processing completed for ${username} (won ${winAmount} at ${cashedAt}x)`,
            );
          }
          // Player lost if they didn't cash out
          else {
            this.logger.log(
              `💔 [Gateway] Bet #${bet.id} is a LOSING BET (cashedAt is NULL)`,
            );

            const loseEvent = {
              betId: bet.id,
              betAmount: betAmount,
              crashMultiplier: crashMultiplier,
              timestamp: new Date().toISOString(),
            };

            this.logger.log(
              `📤 [Gateway] PREPARING TO EMIT aviator:lose to ${username} (${userId})`,
            );
            this.logger.log(`   - Lose Event: ${JSON.stringify(loseEvent)}`);

            // Check if user is in activeUsers map
            if (!socketId) {
              this.logger.error(
                `❌ [Gateway] CRITICAL: User ${username} (${userId}) NOT FOUND in activeUsers map!`,
              );
              this.logger.error(
                `   - activeUsers map has ${this.activeUsers.size} entries`,
              );
              this.logger.error(
                `   - User IDs in map: ${Array.from(this.activeUsers.keys()).join(', ')}`,
              );
            }

            // Send to specific user if connected
            // Try TWO methods: room-based (primary) and direct socket (fallback)
            this.logger.log(
              `� [Gateway] Attempting to send lose event via room: ${userId}`,
            );

            // Method 1: Send via personal room (RECOMMENDED - more reliable)
            this.server.to(userId).emit('aviator:lose', loseEvent);
            this.logger.log(
              `✅ [Gateway] LOSE event sent via room to ${username}`,
            );

            // Method 2: Also try direct socket send as fallback
            if (socketId) {
              const socket = this.getSocketById(socketId);
              if (socket) {
                socket.emit('aviator:lose', loseEvent);
                this.logger.log(
                  `✅ [Gateway] LOSE event also sent via direct socket to ${username}`,
                );
              } else {
                this.logger.warn(
                  `⚠️ [Gateway] Socket ${socketId} not found for fallback send to ${username}`,
                );
              }
            } else {
              this.logger.warn(
                `⚠️ [Gateway] User ${username} not in activeUsers map, relied on room-based send`,
              );
            }

            this.logger.log(
              `✅ [Gateway] LOSE event processing completed for ${username} (lost ${betAmount} at ${crashMultiplier}x)`,
            );
          }
        } catch (betError) {
          this.logger.error(
            `❌ [Gateway] Error processing result for bet #${bet.id}:`,
            betError,
          );
        }
      }

      this.logger.log(
        `✅ [Gateway] Finished processing all ${game.bets.length} bets`,
      );
    } catch (error) {
      this.logger.error('❌ [Gateway] Error in processGameResults:', error);
    }
  }

  /**
   * Send personalized win/lose events to each player after game crash
   * @deprecated Use processGameResults instead
   */
  private async sendWinLoseEvents(game: any) {
    try {
      const crashMultiplier = Number(game.multiplier);

      // Проверяем что у игры есть ставки
      if (!game.bets || game.bets.length === 0) {
        this.logger.debug('No bets in game, skipping win/lose events');
        return;
      }

      // Проверяем что server.sockets.sockets существует
      if (
        !this.server ||
        !this.server.sockets ||
        !this.server.sockets.sockets
      ) {
        this.logger.error('Server sockets not available');
        return;
      }

      // Получаем всех игроков с их ставками
      for (const bet of game.bets) {
        try {
          const userId = bet.user?.id;
          const username = bet.user?.username || 'Unknown';

          if (!userId) {
            this.logger.warn(`Bet #${bet.id} has no user ID, skipping`);
            continue;
          }

          const socketId = this.activeUsers.get(userId);

          if (!socketId) {
            this.logger.debug(
              `User ${userId} (${username}) not connected, skipping win/lose event`,
            );
            continue;
          }

          const socket = this.getSocketById(socketId);

          if (!socket) {
            this.logger.debug(
              `Socket ${socketId} for user ${userId} not found, skipping`,
            );
            continue;
          }

          const betAmount = Number(bet.amount);
          const cashedAt = bet.cashedAt ? Number(bet.cashedAt) : null;

          // Игрок выиграл если сделал cashout
          if (cashedAt !== null) {
            const winAmount = Math.floor(betAmount * cashedAt);
            socket.emit('aviator:win', {
              betId: bet.id,
              betAmount: betAmount,
              cashedAt: cashedAt,
              winAmount: winAmount,
              crashMultiplier: crashMultiplier,
              timestamp: new Date().toISOString(),
            });
            this.logger.log(
              `✅ Sent WIN event to ${username}: won ${winAmount} (cashed at ${cashedAt}x)`,
            );
          }
          // Игрок проиграл если не сделал cashout
          else {
            socket.emit('aviator:lose', {
              betId: bet.id,
              betAmount: betAmount,
              crashMultiplier: crashMultiplier,
              timestamp: new Date().toISOString(),
            });
            this.logger.log(
              `❌ Sent LOSE event to ${username}: lost ${betAmount} (crashed at ${crashMultiplier}x)`,
            );
          }
        } catch (betError) {
          this.logger.error(
            `Error sending win/lose event for bet #${bet.id}: ${betError.message}`,
            betError.stack,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `Error in sendWinLoseEvents: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * Add crash multiplier to history
   */
  private addToCrashHistory(multiplier: number) {
    // Добавляем в начало массива (самый новый краш)
    this.crashHistory.unshift(multiplier);

    // Ограничиваем размер истории
    if (this.crashHistory.length > this.MAX_CRASH_HISTORY) {
      this.crashHistory = this.crashHistory.slice(0, this.MAX_CRASH_HISTORY);
    }

    this.logger.log(
      `📊 Crash history updated: [${this.crashHistory.slice(0, 5).join(', ')}...]`,
    );
  }

  /**
   * Broadcast crash history to all clients
   */
  /**
   * Broadcast crash history to all clients
   */
  private broadcastCrashHistory() {
    try {
      this.server.emit('aviator:crashHistory', {
        history: this.crashHistory,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      this.logger.error(
        `Error broadcasting crash history: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * Get crash history (for new connections)
   */
  private getCrashHistory(): number[] {
    return this.crashHistory;
  }

  async handleConnection(client: Socket) {
    try {
      this.logger.log(
        `🔌 New connection attempt: ${client.id} on namespace: ${client.nsp.name}`,
      );

      // Extract token from handshake auth or query
      const token =
        client.handshake.auth?.token || client.handshake.query?.token;

      if (!token) {
        this.logger.warn(`Client ${client.id} connected without token`);
        client.disconnect();
        return;
      }

      // Verify JWT token
      const payload = this.jwtService.verify(token as string);

      // Validate user exists and is not banned
      const user = await this.prisma.user.findUnique({
        where: { id: payload.id },
        select: {
          id: true,
          isBanned: true,
          role: true,
          username: true,
        },
      });
      // test

      if (!user) {
        this.logger.warn(`User not found for token: ${client.id}`);
        client.disconnect();
        return;
      }

      if (user.isBanned) {
        this.logger.warn(`Banned user tried to connect: ${user.id}`);
        client.disconnect();
        return;
      }

      // Check if user already has an active connection
      const existingSocketId = this.activeUsers.get(user.id);
      if (existingSocketId) {
        const existingSocket = this.getSocketById(existingSocketId);
        if (existingSocket) {
          this.logger.log(
            `User ${user.username} (${user.id}) already connected. Disconnecting old socket ${existingSocketId}`,
          );
          existingSocket.emit('disconnected', {
            reason: 'New connection from another device',
          });
          existingSocket.disconnect(true);
        }
      }

      // Store user ID in socket data
      client.data.userId = user.id;
      client.data.username = user.username;
      client.data.role = user.role;

      // 🚨 CRITICAL: Join user to personal room for targeted events (win/lose)
      // Each user has their OWN personal room (userId)
      client.join(user.id);
      this.logger.log(
        `🚪 [Gateway] User ${user.username} joined personal room: ${user.id}`,
      );

      // Join SHARED game room if current game exists
      // ALL players join the SAME game room (aviator-game-{gameId})
      try {
        // Try to get current game (may not exist yet)
        const currentGame = await this.prisma.aviator.findFirst({
          where: {
            status: {
              in: ['WAITING', 'ACTIVE'],
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
        });

        if (currentGame) {
          const gameRoom = `aviator-game-${currentGame.id}`;
          client.join(gameRoom);
          this.logger.log(
            `🚪 [Gateway] User ${user.username} joined SHARED game room: ${gameRoom}`,
          );
        } else {
          this.logger.log(
            `📝 [Gateway] No active game yet, user ${user.username} will join game room when game is created`,
          );
        }
      } catch (error) {
        this.logger.warn(
          `Could not join game room for user ${user.username}: ${error.message}`,
        );
      }

      // Add to active users (replace any existing connection)
      this.activeUsers.set(user.id, client.id);

      this.logger.log(
        `✅ User ${user.username} (${user.id}) connected with socket ${client.id}`,
      );
      this.logger.log(
        `   - Added to activeUsers map (size: ${this.activeUsers.size})`,
      );
      this.logger.log(
        `   - Active users: ${Array.from(this.activeUsers.keys()).slice(0, 5).join(', ')}...`,
      );

      // Emit active users count to all clients
      this.broadcastActiveUsersCount();

      // Send welcome message to connected client
      client.emit('connected', {
        message: 'Connected successfully',
        activeUsers: this.getActiveUsersCount(),
      });

      // Отправляем историю крашей новому клиенту
      client.emit('aviator:crashHistory', {
        history: this.getCrashHistory(),
        timestamp: new Date().toISOString(),
      });

      // Send initial prizes to new client
      client.emit('case:initialPrizes', {
        prizes: this.initialPrizes,
        timestamp: new Date().toISOString(),
      });

      // Add catch-all event listener to log all incoming events
      client.onAny((eventName, ...args) => {
        this.logger.log(
          `📨 Received event: ${eventName} from client ${client.id} (user: ${client.data.userId})`,
        );
        this.logger.debug(`Event data:`, args);
      });
    } catch (error) {
      this.logger.error(`Connection error: ${error.message}`, error.stack);
      client.disconnect();
    }
  }

  async handleDisconnect(client: Socket) {
    const userId = client.data.userId;
    const username = client.data.username;

    if (userId) {
      // Only remove if this is the current active socket for the user
      const currentSocketId = this.activeUsers.get(userId);
      if (currentSocketId === client.id) {
        this.activeUsers.delete(userId);
        this.logger.log(
          `User ${username} (${userId}) disconnected socket ${client.id}`,
        );
        // Broadcast updated active users count
        this.broadcastActiveUsersCount();
      } else {
        this.logger.log(
          `Old socket ${client.id} for user ${username} (${userId}) disconnected (already replaced)`,
        );
      }
    } else {
      this.logger.log(`Client ${client.id} disconnected`);
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('ping')
  handlePing(@ConnectedSocket() client: Socket): { event: string; data: any } {
    return {
      event: 'pong',
      data: {
        timestamp: new Date().toISOString(),
        activeUsers: this.getActiveUsersCount(),
      },
    };
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('getServerTime')
  handleGetServerTime(@ConnectedSocket() client: Socket): {
    event: string;
    data: any;
  } {
    return {
      event: 'serverTime',
      data: {
        serverTime: Date.now(),
        serverTimestamp: new Date().toISOString(),
        multiplierFormula: 5000, // ms per 1.0x
        tickRate: 50, // ms between ticks
      },
    };
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('getActiveUsers')
  handleGetActiveUsers(@ConnectedSocket() client: Socket): {
    event: string;
    data: any;
  } {
    return {
      event: 'activeUsersCount',
      data: {
        count: this.getActiveUsersCount(),
        timestamp: new Date().toISOString(),
      },
    };
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('aviator:createOrGet')
  async handleCreateOrGetAviator(@ConnectedSocket() client: Socket) {
    this.logger.log(
      `🎮 HANDLER START: aviator:createOrGet from client ${client.id}, userId: ${client.data.userId}`,
    );
    try {
      this.logger.log(`Client ${client.id} requesting aviator game`);
      const game = await this.aviatorService.createOrGetAviator();

      // Convert Decimal fields to numbers for JSON serialization
      const response = {
        ...game,
        multiplier: Number(game.multiplier),
        bets: game.bets.map((bet) => ({
          ...bet,
          amount: Number(bet.amount),
          cashedAt: bet.cashedAt ? Number(bet.cashedAt) : null,
        })),
      };

      this.logger.log(
        `Sending aviator game #${game.id} to client ${client.id}`,
      );

      return {
        event: 'aviator:game',
        data: response,
      };
    } catch (error) {
      this.logger.error('Error in aviator:createOrGet', error);
      return {
        event: 'error',
        data: {
          message: error.message || 'Failed to create or get aviator game',
        },
      };
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('aviator:getCurrent')
  async handleGetCurrentAviator(@ConnectedSocket() client: Socket) {
    this.logger.log(
      `🎮 HANDLER START: aviator:getCurrent from client ${client.id}, userId: ${client.data.userId}`,
    );
    try {
      this.logger.log(`Client ${client.id} requesting current aviator game`);
      const game = await this.aviatorService.getCurrentGame();

      if (!game) {
        this.logger.log(`No active aviator game found for client ${client.id}`);
        return {
          event: 'aviator:noGame',
          data: null,
        };
      }

      // ⚠️ EMERGENCY CHECK: If game is WAITING but should have started, start it NOW
      const now = Date.now();
      const startTime = new Date(game.startsAt).getTime();

      if (game.status === 'WAITING' && startTime < now) {
        const elapsed = now - startTime;
        this.logger.warn(
          `⚠️ [Emergency] Game #${game.id} should have started ${Math.floor(elapsed / 1000)}s ago! Starting NOW...`,
        );

        // Start the game immediately
        await this.startGame(game.id);

        // Get the updated game
        const updatedGame = await this.aviatorService.getCurrentGame();

        const response = {
          ...updatedGame,
          multiplier: Number(updatedGame.multiplier),
          bets: updatedGame.bets.map((bet) => ({
            ...bet,
            amount: Number(bet.amount),
            cashedAt: bet.cashedAt ? Number(bet.cashedAt) : null,
          })),
        };

        this.logger.log(
          `✅ [Emergency] Started game #${updatedGame.id} and sent to client ${client.id}`,
        );

        return {
          event: 'aviator:game',
          data: response,
        };
      }

      // Convert Decimal fields to numbers
      const response = {
        ...game,
        multiplier: Number(game.multiplier),
        bets: game.bets.map((bet) => ({
          ...bet,
          amount: Number(bet.amount),
          cashedAt: bet.cashedAt ? Number(bet.cashedAt) : null,
        })),
      };

      this.logger.log(
        `Sending current aviator game #${game.id} to client ${client.id}`,
      );

      return {
        event: 'aviator:game',
        data: response,
      };
    } catch (error) {
      this.logger.error('Error in aviator:getCurrent', error);
      return {
        event: 'error',
        data: {
          message: error.message || 'Failed to get current aviator game',
        },
      };
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('aviator:placeBet')
  async handlePlaceBet(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { aviatorId: number; amount: number },
  ) {
    try {
      const userId = client.data.userId;
      const username = client.data.username;

      this.logger.log(
        `🎰 [BET] User ${username} (${userId}) placing bet on aviator #${data.aviatorId} for ${data.amount}`,
      );

      // Check if user is in activeUsers map
      const socketId = this.activeUsers.get(userId);
      this.logger.log(
        `🔍 [BET] User ${username} activeUsers check: ${socketId ? `✅ Found (${socketId})` : '❌ NOT FOUND'}`,
      );
      this.logger.log(
        `📊 [BET] Current activeUsers map size: ${this.activeUsers.size}`,
      );

      if (!data.aviatorId || !data.amount) {
        this.logger.warn(
          `Invalid bet data from user ${userId}: ${JSON.stringify(data)}`,
        );
        return {
          event: 'error',
          data: {
            message: 'aviatorId and amount are required',
          },
        };
      }

      const bet = await this.aviatorService.placeBet(
        userId,
        data.aviatorId,
        data.amount,
      );

      this.logger.log(
        `✅ [BET] Bet #${bet.id} placed successfully by ${username} (${userId}). Broadcasting to all clients.`,
      );

      // Verify user is still in activeUsers after bet placement
      const socketIdAfter = this.activeUsers.get(userId);
      this.logger.log(
        `🔍 [BET] User ${username} activeUsers check AFTER bet: ${socketIdAfter ? `✅ Found (${socketIdAfter})` : '❌ NOT FOUND'}`,
      );

      // Convert Decimal to number for JSON
      const betResponse = {
        id: bet.id,
        aviatorId: bet.aviatorId,
        userId: bet.userId,
        amount: Number(bet.amount),
        cashedAt: bet.cashedAt ? Number(bet.cashedAt) : null,
        isInventoryBet: bet.isInventoryBet,
        createdAt: bet.createdAt,
        updatedAt: bet.updatedAt,
        user: bet.user,
      };

      // Broadcast new bet to all clients
      this.server.emit('aviator:newBet', {
        betId: bet.id,
        aviatorId: bet.aviatorId,
        userId: bet.userId,
        username: bet.user.username,
        amount: Number(bet.amount),
        timestamp: bet.createdAt,
      });

      this.logger.log(
        `✅ Returning bet response to client: betId=${bet.id}, amount=${Number(bet.amount)}`,
      );

      return {
        event: 'aviator:betPlaced',
        data: betResponse,
      };
    } catch (error) {
      this.logger.error(
        `Error placing bet for user ${client.data.userId}: ${error.message}`,
        error.stack,
      );
      return {
        event: 'error',
        data: {
          message: error.message || 'Failed to place bet',
        },
      };
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('aviator:cashOut')
  async handleCashOut(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { betId: number; currentMultiplier: number },
  ) {
    try {
      const userId = client.data.userId;
      this.logger.log(
        `User ${userId} cashing out bet #${data.betId} at ${data.currentMultiplier}x`,
      );

      if (!data.betId || !data.currentMultiplier) {
        this.logger.warn(
          `Invalid cashout data from user ${userId}: ${JSON.stringify(data)}`,
        );
        return {
          event: 'error',
          data: {
            message: 'betId and currentMultiplier are required',
          },
        };
      }

      const result = await this.aviatorService.cashOut(
        userId,
        data.betId,
        data.currentMultiplier,
      );

      this.logger.log(
        `User ${userId} cashed out bet #${data.betId} successfully. Win: ${result.winAmount}. Broadcasting to all clients.`,
      );

      // Broadcast cash out to all clients (public event showing someone cashed out)
      this.server.emit('aviator:cashOut', {
        betId: result.bet.id,
        aviatorId: result.bet.aviatorId,
        userId: result.bet.userId,
        username: result.bet.user.username,
        amount: result.bet.amount,
        multiplier: result.multiplier,
        winAmount: result.winAmount,
        timestamp: result.bet.updatedAt,
      });

      this.logger.log(
        `📡 [Gateway] Broadcasted aviator:cashOut event to all clients`,
      );

      // Send personal win event to the player
      const winEvent = {
        betId: result.bet.id,
        betAmount: result.bet.amount,
        cashedAt: result.multiplier,
        winAmount: result.winAmount,
        crashMultiplier: null, // Will be set when game crashes
        timestamp: new Date().toISOString(),
      };

      this.logger.log(
        `📤 [Gateway] EMITTING aviator:win after cashout to user ${result.bet.user.username}: ${JSON.stringify(winEvent)}`,
      );

      // Method 1: Send via personal room (RECOMMENDED - more reliable)
      this.server.to(userId).emit('aviator:win', winEvent);
      this.logger.log(
        `✅ [Gateway] WIN event sent via room to ${result.bet.user.username}`,
      );

      // Method 2: Also try direct socket send as fallback
      const socketId = this.activeUsers.get(userId);
      if (socketId) {
        const socket = this.getSocketById(socketId);
        if (socket) {
          socket.emit('aviator:win', winEvent);
          this.logger.log(
            `✅ [Gateway] WIN event also sent via direct socket to ${result.bet.user.username}`,
          );
        } else {
          this.logger.warn(
            `⚠️ [Gateway] Socket ${socketId} not found for fallback send after cashout`,
          );
        }
      } else {
        this.logger.warn(
          `⚠️ [Gateway] User ${userId} not in activeUsers map after cashout, relied on room-based send`,
        );
      }

      this.logger.log(
        `✅ [Gateway] WIN event after cashout completed for ${result.bet.user.username} (won ${result.winAmount} at ${result.multiplier}x)`,
      );

      return {
        event: 'aviator:cashedOut',
        data: result,
      };
    } catch (error) {
      this.logger.error(
        `Error cashing out for user ${client.data.userId}: ${error.message}`,
        error.stack,
      );
      return {
        event: 'error',
        data: {
          message: error.message || 'Failed to cash out',
        },
      };
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('aviator:depositInventory')
  async handleDepositInventory(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { inventoryItemId: number; aviatorId: number },
  ) {
    try {
      const userId = client.data.userId;
      this.logger.log(
        `User ${userId} depositing inventory item #${data.inventoryItemId} to aviator #${data.aviatorId}`,
      );

      if (!data.inventoryItemId || !data.aviatorId) {
        this.logger.warn(
          `Invalid deposit data from user ${userId}: ${JSON.stringify(data)}`,
        );
        return {
          event: 'error',
          data: {
            message: 'inventoryItemId and aviatorId are required',
          },
        };
      }

      const result = await this.aviatorService.depositInventoryItem(
        userId,
        data.inventoryItemId,
        data.aviatorId,
      );

      this.logger.log(
        `User ${userId} deposited inventory item successfully. Bet #${result.betId} created. Broadcasting to all clients.`,
      );

      // Broadcast new inventory bet to all clients
      this.server.emit('aviator:newInventoryBet', {
        betId: result.betId,
        aviatorId: result.aviatorId,
        userId: userId,
        username: client.data.username,
        initialAmount: result.initialAmount,
        depositedItem: result.depositedItem,
        timestamp: result.createdAt,
      });

      return {
        event: 'aviator:inventoryDeposited',
        data: result,
      };
    } catch (error) {
      this.logger.error(
        `Error depositing inventory for user ${client.data.userId}: ${error.message}`,
        error.stack,
      );
      return {
        event: 'error',
        data: {
          message: error.message || 'Failed to deposit inventory item',
        },
      };
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('aviator:getPossiblePrize')
  async handleGetPossiblePrize(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { currentAmount: number },
  ) {
    try {
      const userId = client.data.userId;
      this.logger.log(
        `User ${userId} requesting possible prize for amount ${data.currentAmount}`,
      );

      if (!data.currentAmount) {
        this.logger.warn(
          `Invalid prize request from user ${userId}: ${JSON.stringify(data)}`,
        );
        return {
          event: 'error',
          data: {
            message: 'currentAmount is required',
          },
        };
      }

      const prize = await this.aviatorService.getPossiblePrize(
        data.currentAmount,
      );

      this.logger.log(
        `User ${userId} possible prize: ${prize ? prize.name : 'none'}`,
      );

      return {
        event: 'aviator:possiblePrize',
        data: prize,
      };
    } catch (error) {
      this.logger.error(
        `Error getting possible prize for user ${client.data.userId}: ${error.message}`,
        error.stack,
      );
      return {
        event: 'error',
        data: {
          message: error.message || 'Failed to get possible prize',
        },
      };
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('aviator:cashOutGift')
  async handleCashOutGift(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { betId: number; currentMultiplier: number },
  ) {
    try {
      const userId = client.data.userId;
      this.logger.log(
        `User ${userId} cashing out gift from bet #${data.betId} at ${data.currentMultiplier}x`,
      );

      if (!data.betId || !data.currentMultiplier) {
        this.logger.warn(
          `Invalid gift cashout data from user ${userId}: ${JSON.stringify(data)}`,
        );
        return {
          event: 'error',
          data: {
            message: 'betId and currentMultiplier are required',
          },
        };
      }

      const result = await this.aviatorService.cashoutGift(
        userId,
        data.betId,
        data.currentMultiplier,
      );

      this.logger.log(
        `User ${userId} cashed out gift successfully. Prize: ${result.prize.name}. Broadcasting to all clients.`,
      );

      // Broadcast gift cash out to all clients
      this.server.emit('aviator:giftCashedOut', {
        betId: result.betId,
        userId: userId,
        username: client.data.username,
        initialAmount: result.initialAmount,
        finalAmount: result.finalAmount,
        multiplier: result.cashedAt,
        prize: result.prize,
        timestamp: new Date(),
      });

      return {
        event: 'aviator:giftCashed',
        data: result,
      };
    } catch (error) {
      this.logger.error(
        `Error cashing out gift for user ${client.data.userId}: ${error.message}`,
        error.stack,
      );
      return {
        event: 'error',
        data: {
          message: error.message || 'Failed to cash out gift',
        },
      };
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('aviator:getHistory')
  async handleGetHistory(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { limit?: number },
  ) {
    this.logger.log(
      `🎮 HANDLER START: aviator:getHistory from client ${client.id}, userId: ${client.data.userId}`,
    );
    try {
      const limit =
        data?.limit && data.limit > 0 && data.limit <= 100 ? data.limit : 20;

      this.logger.log(
        `Client ${client.id} requesting game history (limit: ${limit})`,
      );

      const history = await this.aviatorService.getGameHistory(limit);

      this.logger.log(
        `Sending ${history.length} games history to client ${client.id}`,
      );

      return {
        event: 'aviator:history',
        data: {
          games: history,
          count: history.length,
          timestamp: new Date().toISOString(),
        },
      };
    } catch (error) {
      this.logger.error('Error in aviator:getHistory', error);
      return {
        event: 'error',
        data: {
          message: error.message || 'Failed to get game history',
        },
      };
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('aviator:getCurrentBets')
  async handleGetCurrentBets(@ConnectedSocket() client: Socket) {
    this.logger.log(
      `🎮 HANDLER START: aviator:getCurrentBets from client ${client.id}, userId: ${client.data.userId}`,
    );
    try {
      this.logger.log(`Client ${client.id} requesting current bets`);

      // Get current game
      const game = await this.aviatorService.getCurrentGame();

      if (!game) {
        this.logger.log(`No active game found for client ${client.id}`);
        return {
          event: 'aviator:currentBets',
          data: {
            bets: [],
            count: 0,
            gameId: null,
            timestamp: new Date().toISOString(),
          },
        };
      }

      // Convert Decimal fields to numbers
      const bets = game.bets.map((bet) => ({
        id: bet.id,
        userId: bet.user.id,
        username: bet.user.username,
        amount: Number(bet.amount),
        cashedAt: bet.cashedAt ? Number(bet.cashedAt) : null,
        createdAt: bet.createdAt,
      }));

      this.logger.log(
        `Sending ${bets.length} current bets to client ${client.id}`,
      );

      return {
        event: 'aviator:currentBets',
        data: {
          bets,
          count: bets.length,
          gameId: game.id,
          timestamp: new Date().toISOString(),
        },
      };
    } catch (error) {
      this.logger.error('Error in aviator:getCurrentBets', error);
      return {
        event: 'error',
        data: {
          message: error.message || 'Failed to get current bets',
        },
      };
    }
  }

  /**
   * Safely get a socket by ID
   * @param socketId Socket ID to retrieve
   * @returns Socket instance or undefined if not found
   */
  private getSocketById(socketId: string): Socket | undefined {
    try {
      return this.server?.sockets?.sockets?.get(socketId);
    } catch (error) {
      this.logger.warn(`Failed to get socket ${socketId}:`, error);
      return undefined;
    }
  }

  /**
   * Broadcast a prize won event to all connected clients
   * Called by CaseService when a real prize is won
   */
  broadcastPrizeWon(prizeData: {
    username: string;
    caseName: string;
    prizeName: string;
    prizeAmount: number;
    prizeUrl: string;
    timestamp: string;
    isFake?: boolean;
  }) {
    try {
      // Add to initial prizes history (keep last 20)
      this.initialPrizes.unshift(prizeData);
      if (this.initialPrizes.length > 20) {
        this.initialPrizes = this.initialPrizes.slice(0, 20);
      }

      // Broadcast to all clients
      this.server.emit('case:prizeWon', prizeData);

      this.logger.log(
        `📡 Broadcasted prize won: ${prizeData.username} won ${prizeData.prizeName} from ${prizeData.caseName}`,
      );
    } catch (error) {
      this.logger.error('Failed to broadcast prize won', error);
    }
  }

  // Helper method to get active users count
  getActiveUsersCount(): number {
    return this.activeUsers.size;
  }

  // Broadcast active users count to all connected clients
  private broadcastActiveUsersCount() {
    const count = this.getActiveUsersCount();
    this.server.emit('activeUsersCount', {
      count,
      timestamp: new Date().toISOString(),
    });
  }

  async getActiveUsersDetails(): Promise<
    Array<{
      userId: string;
      username: string;
      socketId: string;
    }>
  > {
    const details = [];
    this.activeUsers.forEach((socketId, userId) => {
      const socket = this.getSocketById(socketId);
      if (socket) {
        details.push({
          userId,
          username: socket.data.username,
          socketId,
        });
      }
    });
    return details;
  }
}
