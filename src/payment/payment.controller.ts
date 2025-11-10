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
} from '@nestjs/swagger';
import { PaymentService } from './payment.service';
import { UserGuard } from '../shared/guards/user.guard';
import { User } from '../shared/decorator/user.decorator';
import { CreateStarsPaymentDto } from './dto/create-stars-payment.dto';

@ApiTags('Payment')
@Controller('payment')
export class PaymentController {
  private readonly logger = new Logger(PaymentController.name);

  constructor(private readonly paymentService: PaymentService) {}

  @Post('stars')
  @UseGuards(UserGuard)
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
}
