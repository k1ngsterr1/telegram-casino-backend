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
import { WsJwtGuard } from './guards/ws-jwt.guard';

@WebSocketGateway({
  cors: {
    origin: ['https://gifty-realm-production.up.railway.app'],
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

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly aviatorService: AviatorService,
  ) {}

  /**
   * Initialize game loop when module starts
   */
  async onModuleInit() {
    this.logger.log('🎮 Starting aviator game loop...');
    await this.startGameLoop();
    this.logger.log('✅ Aviator game loop initialized successfully');
  }

  /**
   * Cleanup when module destroys
   */
  onModuleDestroy() {
    if (this.gameLoopInterval) {
      clearInterval(this.gameLoopInterval);
      this.logger.log('🛑 Game loop stopped');
    }
  }

  /**
   * Start the automatic game loop
   * WAITING (10s) → ACTIVE (game duration) → FINISHED → new WAITING
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

      // Check game state every second
      this.logger.log('⏰ Setting up game loop interval (checking every 1 second)');
      this.gameLoopInterval = setInterval(async () => {
        await this.updateGameState();
      }, 1000);
      
      this.logger.log(`✅ Game loop started successfully. Monitoring game #${game.id}`);
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
   * Update game state based on current time and status
   */
  private async updateGameState() {
    try {
      if (!this.currentGameId) {
        this.logger.warn('⚠️ updateGameState called but currentGameId is null');
        return;
      }

      const game = await this.prisma.aviator.findUnique({
        where: { id: this.currentGameId },
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
        this.logger.warn(
          `Game #${this.currentGameId} not found, creating new one`,
        );
        const newGame = await this.aviatorService.createOrGetAviator();
        this.currentGameId = newGame.id;
        this.broadcastGameState(newGame);
        return;
      }

      const now = new Date();
      const startsAt = new Date(game.startsAt);

      // Debug logging for WAITING state
      if (game.status === 'WAITING') {
        const timeUntilStart = startsAt.getTime() - now.getTime();
        this.logger.debug(
          `⏳ Game #${game.id} WAITING: ${Math.ceil(timeUntilStart / 1000)}s until start (startsAt: ${startsAt.toISOString()}, now: ${now.toISOString()})`,
        );
      }

      // WAITING → ACTIVE transition
      if (game.status === 'WAITING' && now >= startsAt) {
        this.logger.log(
          `🚀 Game #${game.id} transitioning from WAITING to ACTIVE`,
        );

        const updatedGame = await this.aviatorService.updateGameStatus(
          game.id,
          'ACTIVE' as any,
        );

        const gameWithBets = await this.prisma.aviator.findUnique({
          where: { id: game.id },
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

        this.server.emit('aviator:statusChange', {
          gameId: game.id,
          status: 'ACTIVE',
          timestamp: now.toISOString(),
        });

        this.broadcastGameState(gameWithBets);
      }

      // ACTIVE → FINISHED transition
      // Вычисляем когда игра должна крашнуться на основе multiplier
      if (game.status === 'ACTIVE') {
        const gameStartedAt = startsAt.getTime();
        const elapsedMs = now.getTime() - gameStartedAt;

        // Формула: multiplier растет экспоненциально
        // multiplier = 1 + (elapsed / 1000) ^ 1.5 * 3
        // Обратная формула для времени краша:
        // elapsed = ((multiplier - 1) / 3) ^ (1/1.5) * 1000
        const crashMultiplier = Number(game.multiplier);
        const crashTimeMs = Math.pow((crashMultiplier - 1) / 3, 1 / 1.5) * 1000;

        const shouldFinish = elapsedMs >= crashTimeMs;

        if (shouldFinish) {
          this.logger.log(
            `💥 Game #${game.id} transitioning from ACTIVE to FINISHED (crashed at ${game.multiplier}x after ${Math.round(crashTimeMs)}ms)`,
          );

          await this.aviatorService.updateGameStatus(
            game.id,
            'FINISHED' as any,
          );

          // Добавляем краш в историю
          this.addToCrashHistory(crashMultiplier);

          // Отправляем персональные события win/lose каждому игроку
          await this.sendWinLoseEvents(game);

          this.server.emit('aviator:crashed', {
            gameId: game.id,
            multiplier: Number(game.multiplier),
            timestamp: now.toISOString(),
          });

          // Отправляем обновлённую историю крашей всем клиентам
          this.broadcastCrashHistory();

          this.server.emit('aviator:statusChange', {
            gameId: game.id,
            status: 'FINISHED',
            timestamp: now.toISOString(),
          });

          // Wait 3 seconds before creating new game
          setTimeout(async () => {
            const newGame = await this.aviatorService.createOrGetAviator();
            this.currentGameId = newGame.id;
            this.logger.log(
              `🆕 New game #${newGame.id} created with status ${newGame.status}`,
            );
            this.broadcastGameState(newGame);
          }, 3000);
        }
      }

      // Broadcast countdown for WAITING games
      if (game.status === 'WAITING') {
        const timeLeft = Math.max(
          0,
          Math.ceil((startsAt.getTime() - now.getTime()) / 1000),
        );

        this.server.emit('aviator:countdown', {
          gameId: game.id,
          secondsLeft: timeLeft,
          startsAt: startsAt.toISOString(),
        });
      }
    } catch (error) {
      this.logger.error('Error in updateGameState', error);
    }
  }

  /**
   * Broadcast current game state to all clients
   */
  private broadcastGameState(game: any) {
    const response = {
      ...game,
      multiplier: Number(game.multiplier),
      bets: game.bets.map((bet) => ({
        ...bet,
        amount: Number(bet.amount),
        cashedAt: bet.cashedAt ? Number(bet.cashedAt) : null,
      })),
    };

    this.server.emit('aviator:game', response);
  }

  /**
   * Send personalized win/lose events to each player after game crash
   */
  private async sendWinLoseEvents(game: any) {
    const crashMultiplier = Number(game.multiplier);

    // Получаем всех игроков с их ставками
    for (const bet of game.bets) {
      const userId = bet.user.id;
      const socketId = this.activeUsers.get(userId);

      if (!socketId) {
        this.logger.debug(
          `User ${userId} (${bet.user.username}) not connected, skipping win/lose event`,
        );
        continue;
      }

      const socket = this.server.sockets.sockets.get(socketId);
      if (!socket) continue;

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
          `✅ Sent WIN event to ${bet.user.username}: won ${winAmount} (cashed at ${cashedAt}x)`,
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
          `❌ Sent LOSE event to ${bet.user.username}: lost ${betAmount} (crashed at ${crashMultiplier}x)`,
        );
      }
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
  private broadcastCrashHistory() {
    this.server.emit('aviator:crashHistory', {
      history: this.crashHistory,
      timestamp: new Date().toISOString(),
    });
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
        const existingSocket =
          this.server.sockets.sockets.get(existingSocketId);
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

      // Add to active users (replace any existing connection)
      this.activeUsers.set(user.id, client.id);

      this.logger.log(
        `User ${user.username} (${user.id}) connected with socket ${client.id}`,
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
      this.logger.log(
        `User ${userId} placing bet on aviator #${data.aviatorId} for ${data.amount}`,
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
        `Bet #${bet.id} placed successfully by user ${userId}. Broadcasting to all clients.`,
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

      // Broadcast cash out to all clients
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
      const socket = this.server.sockets.sockets.get(socketId);
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
