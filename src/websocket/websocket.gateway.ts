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
import { Logger, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../shared/services/prisma.service';
import { AviatorService } from '../admin/aviator/aviator.service';
import { WsJwtGuard } from './guards/ws-jwt.guard';

@WebSocketGateway({
  cors: {
    origin: [
      'https://tma-frontend-production-1702.up.railway.app',
      'https://miniapp.arcticpay.app',
      'https://admin-panel.arcticpay.app',
      'http://localhost:3000',
    ],
    credentials: true,
  },
  namespace: '/ws',
})
export class WebsocketGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(WebsocketGateway.name);
  private activeUsers: Map<string, string> = new Map(); // userId -> socket ID (only one connection per user)

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly aviatorService: AviatorService,
  ) {}

  async handleConnection(client: Socket) {
    try {
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
    try {
      const game = await this.aviatorService.createOrGetAviator();
      return {
        event: 'aviator:game',
        data: game,
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
    try {
      const game = await this.aviatorService.getCurrentGame();
      return {
        event: 'aviator:game',
        data: game,
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

      if (!data.aviatorId || !data.amount) {
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

      // Broadcast new bet to all clients
      this.server.emit('aviator:newBet', {
        betId: bet.id,
        aviatorId: bet.aviatorId,
        userId: bet.userId,
        username: bet.user.username,
        amount: bet.amount,
        timestamp: bet.createdAt,
      });

      return {
        event: 'aviator:betPlaced',
        data: bet,
      };
    } catch (error) {
      this.logger.error('Error in aviator:placeBet', error);
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

      if (!data.betId || !data.currentMultiplier) {
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
      this.logger.error('Error in aviator:cashOut', error);
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

      if (!data.inventoryItemId || !data.aviatorId) {
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
      this.logger.error('Error in aviator:depositInventory', error);
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
      if (!data.currentAmount) {
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

      return {
        event: 'aviator:possiblePrize',
        data: prize,
      };
    } catch (error) {
      this.logger.error('Error in aviator:getPossiblePrize', error);
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

      if (!data.betId || !data.currentMultiplier) {
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
      this.logger.error('Error in aviator:cashOutGift', error);
      return {
        event: 'error',
        data: {
          message: error.message || 'Failed to cash out gift',
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
