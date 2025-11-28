import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TonApiClient } from '@ton-api/client';
import { Address } from '@ton/core';

@Injectable()
export class TonService implements OnModuleInit {
  private price: number;
  private address: Address;
  private readonly logger = new Logger(TonService.name);
  private ton: TonApiClient;
  // Telegram Stars conversion rate: 1 Star = $0.013 USD
  private readonly STARS_TO_USD_RATE = 0.013;

  getStarsToUsdRate(): number {
    return this.STARS_TO_USD_RATE;
  } 

  constructor(private configService: ConfigService) {
    const API_KEY = this.configService.getOrThrow<string>('TON_API_KEY');
    const wallet = this.configService.getOrThrow<string>('TON_WALLET_ADDRESS');
    this.address = Address.parseFriendly(wallet).address;
    this.ton = new TonApiClient({
      baseUrl: 'https://tonapi.io',
      apiKey: API_KEY,
    });
  }

  async onModuleInit() {
    await this.getTonPrice();
  }

  async getPrice(): Promise<number> {
    if (!this.price) {
      await this.getTonPrice();
    }
    return this.price;
  }

  async convertToUSD(amount: number): Promise<number> {
    const price = await this.getPrice();
    return amount * price;
  }

  async convertToStars(usd: number): Promise<number> {
    return parseFloat((usd / this.STARS_TO_USD_RATE).toFixed(2));
  }

  async getTonInfo() {
    const tonPriceUsd = await this.getPrice();
    const tonPriceInStars = await this.convertToStars(tonPriceUsd);
    return {
      tonPriceUsd,
      tonPriceInStars,
      starsToUsdRate: this.STARS_TO_USD_RATE,
    };
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async getTonPrice(): Promise<number> {
    try {
      const response = await this.ton.rates.getRates({
        tokens: ['ton'],
        currencies: ['usd'],
      });

      this.price = response.rates['TON'].prices['USD'];
    } catch (error) {
      this.logger.error('Failed to fetch TON price', error);
    }
    return this.price;
  }

  async getTransactions(lt: bigint) {
    try {
      const response =
        await this.ton.blockchain.getBlockchainAccountTransactions(
          this.address,
          { after_lt: lt },
        );

      return response.transactions;
    } catch (error) {
      this.logger.error('Failed to fetch TON transactions', error);
      return null;
    }
  }
}
