import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AdminGuard } from '../shared/guards/admin.guard';
import { WebsocketGateway } from './websocket.gateway';
import { AuthGuard } from '@nestjs/passport';

@ApiTags('Admin - WebSocket')
@Controller('admin/websocket')
@UseGuards(AuthGuard('jwt'), AdminGuard)
@ApiBearerAuth('JWT')
export class AdminWebsocketController {
  constructor(private readonly websocketGateway: WebsocketGateway) {}

  @Get('active-users')
  @ApiOperation({ summary: 'Get active users count' })
  @ApiResponse({
    status: 200,
    description: 'Returns count of active users',
  })
  getActiveUsersCount() {
    return {
      count: this.websocketGateway.getActiveUsersCount(),
      timestamp: new Date().toISOString(),
    };
  }

  @Get('active-users/details')
  @ApiOperation({ summary: 'Get detailed active users information' })
  @ApiResponse({
    status: 200,
    description: 'Returns detailed information about active users',
  })
  getActiveUsersDetails() {
    return {
      users: this.websocketGateway.getActiveUsersDetails(),
      totalCount: this.websocketGateway.getActiveUsersCount(),
      timestamp: new Date().toISOString(),
    };
  }
}
