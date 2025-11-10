import { ApiProperty } from '@nestjs/swagger';

export enum TransactionType {
  BET = 'Ставка',
  DEPOSIT = 'Пополнение',
  WITHDRAWAL = 'Вывод',
  WIN = 'Выигрыш',
}

export enum TransactionStatus {
  PENDING = 'В обработке',
  COMPLETED = 'Выполнено',
  FAILED = 'Ошибка',
}

export class TransactionDto {
  @ApiProperty({ description: 'Transaction ID', example: 'tx_0' })
  id: string;

  @ApiProperty({ description: 'User identifier', example: 'user_42' })
  user: string;

  @ApiProperty({
    description: 'Transaction type',
    enum: TransactionType,
    example: TransactionType.BET,
  })
  type: TransactionType;

  @ApiProperty({
    description: 'Game name (if applicable)',
    example: 'Колесо',
    nullable: true,
  })
  game: string | null;

  @ApiProperty({ description: 'Transaction amount', example: 23301 })
  amount: number;

  @ApiProperty({
    description: 'Transaction status',
    enum: TransactionStatus,
    example: TransactionStatus.PENDING,
  })
  status: TransactionStatus;

  @ApiProperty({
    description: 'Transaction date',
    example: '2025-11-05T17:21:00.000Z',
  })
  date: Date;
}

export class TransactionsResponseDto {
  @ApiProperty({ type: [TransactionDto] })
  data: TransactionDto[];

  @ApiProperty({
    description: 'Pagination metadata',
    example: { total: 150, page: 1, limit: 20, totalPages: 8 },
  })
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}
