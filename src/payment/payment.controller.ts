import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpException,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
} from '@nestjs/swagger';
import { PaymentService } from './payment.service';
import { UserGuard } from '../shared/guards/user.guard';
import { User } from '../shared/decorator/user.decorator';
import { CreateStarsPaymentDto } from './dto/create-stars-payment.dto';
import { InitiateTonPaymentDto } from './dto/initiate-ton-payment.dto';
import { AuthGuard } from '@nestjs/passport';

@ApiTags('Payment')
@Controller('payment')
export class PaymentController {
  private readonly logger = new Logger(PaymentController.name);

  constructor(private readonly paymentService: PaymentService) {}

  @Post('stars')
  @UseGuards(AuthGuard('jwt'), UserGuard)
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Create Telegram Stars payment invoice' })
  @ApiResponse({
    status: 201,
    description: 'Invoice created successfully, returns invoice link',
  })
  async createStarsPayment(
    @Body() createStarsPaymentDto: CreateStarsPaymentDto,
    @User('id') userId: string,
  ) {
    try {
      return await this.paymentService.createStarsInvoice(
        userId,
        createStarsPaymentDto,
      );
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error('Failed to create stars payment', error);
      throw new HttpException('Failed to create payment', 500);
    }
  }

  @Post('ton/webhook')
  @ApiOperation({
    summary: 'TON blockchain webhook',
    description:
      'Webhook endpoint for receiving TON blockchain transaction notifications. This endpoint is called when a TON payment is confirmed on the blockchain.',
  })
  @ApiResponse({
    status: 200,
    description: 'Webhook processed successfully',
    schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean',
          description: 'Whether the webhook was processed successfully',
          example: true,
        },
        message: {
          type: 'string',
          description: 'Response message',
          example: 'Payment confirmed',
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request - Invalid payload or signature',
  })
  @ApiResponse({
    status: 404,
    description: 'Not Found - Payment not found',
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error',
  })
  async tonWebhook(@Body() data: any) {
    return await this.paymentService.tonWebhook(data);
  }

  @Post('ton/initiate')
  @ApiBearerAuth('JWT')
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({
    summary: 'Initiate TON payment',
    description:
      'Initiates a TON payment for the authenticated user. Creates a payment record with PENDING status.',
  })
  @ApiBody({ type: InitiateTonPaymentDto })
  @ApiResponse({
    status: 201,
    description: 'TON payment initiated successfully',
    schema: {
      type: 'object',
      properties: {
        paymentId: {
          type: 'string',
          description: 'Payment ID',
        },
        amount: {
          type: 'number',
          description: 'Payment amount in USD',
        },
        provider: {
          type: 'string',
          enum: ['NOWPAYMENTS'],
          description: 'Payment provider',
        },
        status: {
          type: 'string',
          enum: ['PENDING', 'COMPLETED', 'FAILED'],
          description: 'Payment status',
        },
        createdAt: {
          type: 'string',
          format: 'date-time',
          description: 'Payment creation timestamp',
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request - Invalid amount or provider',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid or missing JWT token',
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error',
  })
  async initiateTonPayment(
    @User('id') userId: string,
    @Body() data: InitiateTonPaymentDto,
  ) {
    return await this.paymentService.initiateTonPayment(userId, data);
  }
}
