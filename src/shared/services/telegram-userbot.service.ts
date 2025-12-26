import {
  Injectable,
  Logger,
  OnModuleDestroy,
  HttpException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from './prisma.service';
import { GiftService } from './gift.service';
import { Cron } from '@nestjs/schedule';
import { Api, TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import bigInt from 'big-integer';

@Injectable()
export class TelegramUserbotService implements OnModuleDestroy {
  private readonly logger = new Logger(TelegramUserbotService.name);
  private client: TelegramClient = null;
  private isInitialized = false;
  private isInitializing = false;
  private recentPollIntervalId: NodeJS.Timeout | null = null;
  private lastInitRetry: number = 0;

  // Cache for processed messages
  private processedMessages = new Map<string, number>();
  private readonly CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
  private readonly MAX_CACHE_SIZE = 10000;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
    private giftService: GiftService,
  ) {}

  /**
   * Helper method to get user input from stdin
   */
  private promptInput(): Promise<string> {
    return new Promise((resolve) => {
      const stdin = process.stdin;
      stdin.setEncoding('utf8');

      const onData = (data: string) => {
        stdin.removeListener('data', onData);
        stdin.pause();
        resolve(data.toString().trim());
      };

      stdin.resume();
      stdin.once('data', onData);
    });
  }

  async onModuleDestroy() {
    this.logger.log('Shutting down Telegram UserBot service');
    this.stopPollingForGifts();

    if (this.client && this.isInitialized) {
      try {
        await this.client.disconnect();
        this.logger.log('Telegram client disconnected successfully');
      } catch (error) {
        this.logger.warn('Error disconnecting Telegram client:', error.message);
      }
    }

    this.client = null;
    this.isInitialized = false;
    this.isInitializing = false;
  }

  async initialize(): Promise<void> {
    if (!TelegramClient) {
      this.logger.warn(
        '⚠️ Telegram library not installed. Gift monitoring disabled.',
      );
      this.logger.warn(
        'To enable gift monitoring, install: yarn add telegram input',
      );
      return;
    }

    if (this.isInitialized) {
      this.logger.log('Telegram client already initialized, skipping');
      return;
    }

    if (this.isInitializing) {
      this.logger.log('Initialization already in progress, waiting...');
      let attempts = 0;
      while (this.isInitializing && attempts < 30) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        attempts++;
      }
      if (this.isInitialized) {
        return;
      }
      throw new HttpException('Initialization timeout after 30 seconds', 500);
    }

    this.isInitializing = true;

    try {
      // Read credentials from environment variables
      const apiIdStr = process.env.TELEGRAM_API_ID;
      const apiHash = process.env.TELEGRAM_API_HASH;
      const sessionString = process.env.TELEGRAM_SESSION_STRING || '';

      if (!apiIdStr || !apiHash) {
        throw new HttpException(
          'Telegram API credentials not found in environment variables. Please configure TELEGRAM_API_ID and TELEGRAM_API_HASH',
          500,
        );
      }

      const apiId = parseInt(apiIdStr, 10);

      if (isNaN(apiId)) {
        throw new HttpException(
          `Invalid TELEGRAM_API_ID: expected number but received ${apiIdStr}`,
          500,
        );
      }

      this.logger.log(`Initializing Telegram client with API ID: ${apiId}`);

      if (this.client) {
        this.logger.log('Closing existing Telegram client');
        try {
          await this.client.disconnect();
          await new Promise((resolve) => setTimeout(resolve, 3000));
        } catch (error) {
          this.logger.warn('Error closing existing client:', error.message);
        }
        this.client = null;
        this.isInitialized = false;
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));

      const session = new StringSession(sessionString);

      this.client = new TelegramClient(session, apiId, apiHash, {
        connectionRetries: 10,
        timeout: 30000,
        useWSS: false,
        floodSleepThreshold: 0,
      });

      // If no session, authenticate interactively
      if (!sessionString) {
        this.logger.log(
          '🔐 No session found. Starting interactive authentication...',
        );
        this.logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

        await this.client.start({
          phoneNumber: async () => {
            this.logger.log(
              '\n📱 Enter your phone number (e.g., +77085673295):',
            );
            return await this.promptInput();
          },
          password: async () => {
            this.logger.log('\n🔒 2FA password required:');
            return await this.promptInput();
          },
          phoneCode: async () => {
            this.logger.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            this.logger.log('📬 VERIFICATION CODE SENT!');
            this.logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            this.logger.log('');
            this.logger.log(
              '⏰ Code is valid for 10 minutes - take your time!',
            );
            this.logger.log('');
            this.logger.log('📱 WHERE TO FIND THE CODE:');
            this.logger.log(
              '   1. Open Telegram app on ANY device (phone/desktop/web)',
            );
            this.logger.log('   2. Look for "Telegram" service chat');
            this.logger.log('   3. OR check "Saved Messages"');
            this.logger.log('   4. OR check phone SMS');
            this.logger.log('   5. OR wait for a phone call');
            this.logger.log('');
            this.logger.log('💡 The code is 5 DIGITS (example: 12345)');
            this.logger.log('');
            this.logger.log('Enter verification code:');
            return await this.promptInput();
          },
          onError: (err) => {
            this.logger.error('Authentication error:', err.message);
          },
        });

        // Save the session to database
        const newSessionString =
          this.client.session.save() as unknown as string;

        if (newSessionString && newSessionString.length > 0) {
          await this.prisma.system.upsert({
            where: { key: 'TELEGRAM_SESSION_STRING' },
            update: { value: newSessionString },
            create: { key: 'TELEGRAM_SESSION_STRING', value: newSessionString },
          });
          this.logger.log('✅ Session saved to database successfully!');
          this.logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          this.logger.log('📋 COPY THIS TO YOUR .env FILE:');
          this.logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          this.logger.log(`TELEGRAM_SESSION_STRING=${newSessionString}`);
          this.logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          this.logger.log(
            '💡 Add this line to your .env file to avoid re-authentication',
          );
          this.logger.log('');
        }
      } else {
        // Use existing session
        this.logger.log('📡 Connecting to Telegram using saved session...');
        this.logger.log('⏱️  Connection timeout: 60 seconds');

        const connectPromise = this.client.connect().then(() => {
          this.logger.log('✅ Connected to Telegram successfully');
        });

        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(
            () => {
              this.logger.error('❌ Connection timeout exceeded (60s)');
              this.logger.error('💡 Possible causes:');
              this.logger.error(
                '   1. Session expired - try clearing TELEGRAM_SESSION_STRING from .env',
              );
              this.logger.error(
                '   2. Network/firewall blocking Telegram servers',
              );
              this.logger.error(
                '   3. Another instance using the same session',
              );
              reject(
                new HttpException(
                  'Telegram client connect timeout - see logs for troubleshooting',
                  500,
                ),
              );
            },
            60000, // Increased to 60 seconds
          );
        });

        await Promise.race([connectPromise, timeoutPromise]);
      }

      this.isInitialized = true;
      this.isInitializing = false;
      this.logger.log('✅ Telegram UserBot initialized successfully');

      this.startPollingForGifts();
    } catch (error) {
      this.logger.error('Failed to initialize Telegram UserBot:', error);

      if (error.message && error.message.includes('AUTH_KEY_DUPLICATED')) {
        this.logger.error(
          '❌ AUTH_KEY_DUPLICATED detected. This usually means:',
        );
        this.logger.error(
          '1. Another instance of the client is using the same session',
        );
        this.logger.error('2. The session may need to be refreshed');
        this.logger.error('🔧 Try stopping all instances and restarting');
      }

      if (error.message && error.message.includes('connect timeout')) {
        this.logger.error(
          '❌ Connection timeout - clearing session from database',
        );
        try {
          await this.prisma.system
            .delete({
              where: { key: 'TELEGRAM_SESSION_STRING' },
            })
            .catch(() => {});
          this.logger.log(
            '✅ Session cleared. Please restart the app to re-authenticate',
          );
        } catch (clearError) {
          this.logger.warn('Could not clear session:', clearError.message);
        }
      }

      this.isInitialized = false;
      this.isInitializing = false;
      this.client = null;

      this.logger.warn(
        '⚠️ Telegram UserBot Service initialization failed: ' +
          (error.message || error),
      );
      this.logger.warn(
        'ℹ️ Gift monitoring will be disabled. Check your Telegram credentials.',
      );
    }
  }

  async getAllStarGifts() {
    const result = await this.client.invoke(
      new Api.payments.GetStarGifts({ hash: 0 }),
    );
    return result;
  }

  async sendGift() {
    // await this.client.invoke(new Api.payments.GetStarGifts)
  }

  private startPollingForGifts() {
    if (this.recentPollIntervalId) return;

    this.logger.log('Starting gift polling (every 5s)');
    this.recentPollIntervalId = setInterval(async () => {
      try {
        if (!this.client || !this.isInitialized) return;

        const dialogs = await this.client.getDialogs({ limit: 20 });
        let checkedCount = 0;
        let skippedCount = 0;

        for (const dialog of dialogs) {
          try {
            if (!dialog.entity) continue;
            const messages = await this.client.getMessages(dialog.entity, {
              limit: 3,
            });
            for (const message of messages) {
              try {
                const messageKey = this.generateMessageKey(
                  message,
                  (dialog.entity as any).id,
                );

                if (this.isMessageProcessed(messageKey)) {
                  skippedCount++;
                  continue;
                }

                checkedCount++;

                if (this.isRealGiftMessage(message)) {
                  try {
                    let receiverId: string | null = null;

                    if ((message as any).peer?.channelId) {
                      const me = await this.client.getMe();
                      receiverId = (me as any).id?.toString();
                    } else if ((message as any).peerId?.userId) {
                      receiverId = (message as any).peerId.userId.toString();
                    } else {
                      const me = await this.client.getMe();
                      receiverId = (me as any).id?.toString();
                    }

                    if (receiverId) {
                      const giftResult =
                        await this.giftService.processGiftMessage(
                          message,
                          receiverId,
                          this.client,
                        );

                      if (giftResult.success) {
                        let fromUserId: string | undefined;
                        if ((message as any).fromId) {
                          const fromId = (message as any).fromId;
                          if (fromId.userId) {
                            fromUserId = fromId.userId.toString();
                          } else if (fromId.channelId) {
                            fromUserId = fromId.channelId.toString();
                          } else if (
                            typeof fromId === 'number' ||
                            typeof fromId === 'string'
                          ) {
                            fromUserId = fromId.toString();
                          }
                        }

                        const senderInfo = fromUserId
                          ? `from user ${fromUserId}`
                          : 'anonymous';

                        const giftInfo = (message as any).action?.gift;
                        const giftName = giftInfo?.title || 'Unknown';
                        const giftType = (message as any).action?.className;

                        this.logger.log(
                          `[POLL] ✅ Processed ${giftType}: "${giftName}" ${senderInfo} → ${receiverId}`,
                        );
                      }
                    }

                    this.markMessageAsProcessed(messageKey);
                  } catch (giftError) {
                    this.logger.warn(
                      'Gift processing error:',
                      giftError?.message || giftError,
                    );
                    this.markMessageAsProcessed(messageKey);
                  }
                } else {
                  this.markMessageAsProcessed(messageKey);
                }
              } catch (inner) {
                // swallow per-message errors
              }
            }
          } catch (dlgErr) {
            // continue with other dialogs
          }
        }

        if (checkedCount > 0 || skippedCount > 20) {
          this.logger.log(
            `[POLL] Stats: ${checkedCount} checked, ${skippedCount} skipped (cache), cache size: ${this.processedMessages.size}`,
          );
        }
      } catch (pollErr) {
        this.logger.warn('Gift polling error:', pollErr?.message || pollErr);
      }
    }, 5000);
  }

  private stopPollingForGifts() {
    if (this.recentPollIntervalId) {
      clearInterval(this.recentPollIntervalId as any);
      this.recentPollIntervalId = null;
      this.logger.log('Stopped gift polling');
    }
  }

  private generateMessageKey(message: any, dialogId: any): string {
    const messageId = message.id;
    const chatId = dialogId?.toString() || 'unknown';
    const messageDate = message.date;
    return `${chatId}_${messageId}_${messageDate}`;
  }

  private isMessageProcessed(messageKey: string): boolean {
    const processedTime = this.processedMessages.get(messageKey);
    if (!processedTime) return false;

    const now = Date.now();
    if (now - processedTime > this.CACHE_TTL) {
      this.processedMessages.delete(messageKey);
      return false;
    }

    return true;
  }

  private markMessageAsProcessed(messageKey: string): void {
    if (this.processedMessages.size >= this.MAX_CACHE_SIZE) {
      this.cleanupCache();
    }

    this.processedMessages.set(messageKey, Date.now());
  }

  private cleanupCache(): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [key, timestamp] of this.processedMessages.entries()) {
      if (now - timestamp > this.CACHE_TTL) {
        this.processedMessages.delete(key);
        cleanedCount++;
      }
    }

    if (this.processedMessages.size >= this.MAX_CACHE_SIZE) {
      const entries = Array.from(this.processedMessages.entries())
        .sort((a, b) => a[1] - b[1])
        .slice(0, Math.floor(this.MAX_CACHE_SIZE * 0.3));

      entries.forEach(([key]) => {
        this.processedMessages.delete(key);
        cleanedCount++;
      });
    }

    this.logger.log(
      `[CACHE] Cleaned up ${cleanedCount} old message records. Cache size: ${this.processedMessages.size}`,
    );
  }

  @Cron('*/10 * * * * *')
  async cronCheckForGifts() {
    if (!this.isInitialized) {
      const shouldRetryInit =
        !this.lastInitRetry || Date.now() - this.lastInitRetry > 5 * 60 * 1000;

      if (shouldRetryInit && !this.isInitializing) {
        this.logger.log('[CRON] 🔄 Attempting to re-initialize UserBot...');
        this.lastInitRetry = Date.now();

        try {
          await this.initialize();
          this.logger.log('[CRON] ✅ UserBot initialized successfully');
          return;
        } catch (error) {
          this.logger.warn(
            `[CRON] ❌ Re-initialization failed: ${error.message}`,
          );
        }
      }

      return;
    }

    this.logger.log('[CRON] 🔄 Checking for new gifts...');

    try {
      const dialogs = await this.client.getDialogs({ limit: 20 });
      this.logger.log(`[CRON] Checking ${dialogs.length} dialogs for gifts`);

      let processedCount = 0;
      let giftsFound = 0;

      for (const dialog of dialogs) {
        try {
          if (!dialog.entity) continue;

          const messages = await this.client.getMessages(dialog.entity, {
            limit: 10,
          });

          for (const message of messages) {
            try {
              const messageKey = this.generateMessageKey(
                message,
                (dialog.entity as any).id,
              );

              if (this.isMessageProcessed(messageKey)) {
                continue;
              }

              const messageDate = new Date((message as any).date * 1000);
              const now = new Date();
              const timeDiff = now.getTime() - messageDate.getTime();

              if (timeDiff > 5 * 60 * 1000) continue;

              if (this.isRealGiftMessage(message)) {
                try {
                  let receiverId: string | null = null;

                  if ((message as any).peer?.channelId) {
                    const me = await this.client.getMe();
                    receiverId = (me as any).id?.toString();
                  } else if ((message as any).peerId?.userId) {
                    receiverId = (message as any).peerId.userId.toString();
                  } else {
                    const me = await this.client.getMe();
                    receiverId = (me as any).id?.toString();
                  }

                  if (receiverId) {
                    processedCount++;
                    const giftResult =
                      await this.giftService.processGiftMessage(
                        message,
                        receiverId,
                        this.client,
                      );

                    if (giftResult.success) {
                      giftsFound++;

                      let fromUserId: string | undefined;
                      const fromId = (message as any).fromId;
                      if (fromId) {
                        if (fromId.userId) {
                          fromUserId = fromId.userId.toString();
                        } else if (fromId.channelId) {
                          fromUserId = fromId.channelId.toString();
                        } else {
                          fromUserId = fromId.toString();
                        }
                      }

                      const senderInfo = fromUserId
                        ? `from user ${fromUserId}`
                        : 'anonymous';
                      const giftInfo = (message as any).action?.gift;
                      const giftName = giftInfo?.title || 'Unknown';
                      const giftType = (message as any).action?.className;

                      this.logger.log(
                        `[CRON] ✅ Processed ${giftType}: "${giftName}" ${senderInfo} → ${receiverId}`,
                      );
                    }
                  }

                  this.markMessageAsProcessed(messageKey);
                } catch (giftProcessError) {
                  this.logger.warn(
                    `[CRON] Gift processing error:`,
                    giftProcessError?.message || giftProcessError,
                  );
                  this.markMessageAsProcessed(messageKey);
                }
              } else {
                this.markMessageAsProcessed(messageKey);
              }
            } catch (msgError) {
              // Ignore individual message errors
            }
          }
        } catch (dialogError) {
          // Ignore individual dialog errors
        }
      }

      this.logger.log(
        `[CRON] ✅ Gift check completed: ${processedCount} messages processed, ${giftsFound} new gifts found, cache size: ${this.processedMessages.size}`,
      );
    } catch (cronError) {
      this.logger.warn(
        '[CRON] Gift check error:',
        cronError?.message || cronError,
      );
    }
  }

  @Cron('0 0 * * * *')
  async cronCleanupCache() {
    if (this.processedMessages.size > 0) {
      this.logger.log(
        `[CLEANUP] Starting cache cleanup. Current size: ${this.processedMessages.size}`,
      );
      this.cleanupCache();
    }
  }

  private isRealGiftMessage(message: any): boolean {
    return (
      message?.action?.className === 'MessageActionStarGift' ||
      message?.action?.className === 'MessageActionStarGiftUnique'
    );
  }

  // Public API method to send gifts to users
  async sendGiftToUser(
    userId: number,
    giftData: { title: string; description?: string },
  ): Promise<any> {
    if (!this.isInitialized) {
      throw new HttpException('Telegram UserBot not initialized', 500);
    }

    try {
      this.logger.log(`Sending gift notification to user ${userId}`, giftData);

      const userPeer = await this.client.getInputEntity(userId);

      const message = await this.client.sendMessage(userPeer, {
        message: `🎉 Поздравляем! Вы выиграли подарок: ${giftData.title}\n\n${giftData.description || 'Для получения подарка обратитесь к администратору.'}`,
      });

      return {
        success: true,
        messageId: message.id,
        message: `Gift notification sent to user ${userId}`,
      };
    } catch (error) {
      this.logger.error(`Failed to send gift to user ${userId}:`, error);
      throw new HttpException(`Failed to send gift: ${error.message}`, 500);
    }
  }

  /**
   * Get all available star gifts from Telegram
   * Returns the list of gifts that can be purchased and sent
   */
  async getAvailableStarGifts(): Promise<any> {
    if (!this.isInitialized) {
      throw new HttpException('Telegram UserBot not initialized', 500);
    }

    try {
      this.logger.log('Fetching available star gifts from Telegram...');

      const result = await this.client.invoke(
        new Api.payments.GetStarGifts({ hash: 0 }),
      );

      if (result.className === 'payments.StarGiftsNotModified') {
        return { gifts: [], message: 'No changes since last fetch' };
      }

      const starGifts = result as any;
      this.logger.log(`Found ${starGifts.gifts?.length || 0} available gifts`);

      return {
        success: true,
        gifts:
          starGifts.gifts?.map((gift: any) => ({
            id: gift.id?.toString(),
            stars: gift.stars,
            limited: gift.limited || false,
            soldOut: gift.soldOut || false,
            birthday: gift.birthday || false,
            convertStars: gift.convertStars,
            upgradeStars: gift.upgradeStars,
            availabilityRemains: gift.availabilityRemains,
            availabilityTotal: gift.availabilityTotal,
            stickerId: gift.sticker?.id?.toString(),
          })) || [],
      };
    } catch (error) {
      this.logger.error('Failed to get star gifts:', error);
      throw new HttpException(
        `Failed to get star gifts: ${error.message}`,
        500,
      );
    }
  }

  /**
   * Buy and send a star gift to a user using the Telegram payments API
   *
   * This PURCHASES a new gift from Telegram's catalog and sends it to the user.
   * The bot must have enough Telegram Stars balance to cover the cost.
   *
   * Flow:
   * 1. Validate the gift can be sent (not sold out, not locked, etc.)
   * 2. Use payments.getPaymentForm with inputInvoiceStarGift
   * 3. Use payments.sendPaymentForm to complete purchase and send
   *
   * @param targetTelegramId - The telegram user ID to send the gift to
   * @param starGiftId - The catalog gift_id from starGift.id (the type of gift to buy)
   * @param options - Additional options for the gift
   */
  async buyAndSendGiftToUser(
    targetTelegramId: string,
    starGiftId: string,
    options: {
      message?: string;
      hideName?: boolean;
      includeUpgrade?: boolean;
    } = {},
  ): Promise<any> {
    if (!this.isInitialized) {
      throw new HttpException('Telegram UserBot not initialized', 500);
    }

    try {
      this.logger.log(
        `🎁 Preparing to BUY and send gift (catalogId: ${starGiftId}) to user ${targetTelegramId}`,
      );

      // First, validate the gift can be sent
      const validation = await this.validateGiftCanBeSent(starGiftId);
      if (!validation.canSend) {
        throw new HttpException(`Cannot send gift: ${validation.reason}`, 400);
      }

      this.logger.log(
        `✅ Gift validation passed. Cost: ${validation.stars} stars`,
      );

      // Get user peer
      const userPeer = await this.client.getInputEntity(
        parseInt(targetTelegramId),
      );

      // Create the invoice for purchasing the star gift
      // Using inputInvoiceStarGift as per Telegram API
      const invoice = new Api.InputInvoiceStarGift({
        peer: userPeer,
        giftId: bigInt(starGiftId),
        hideName: options.hideName || false,
        includeUpgrade: options.includeUpgrade || false,
        message: options.message
          ? new Api.TextWithEntities({
              text: options.message,
              entities: [],
            })
          : undefined,
      });

      this.logger.log('📋 Getting payment form...');

      // Get payment form - this shows us what we'll pay
      const paymentForm = await this.client.invoke(
        new Api.payments.GetPaymentForm({
          invoice: invoice,
        }),
      );

      this.logger.log(
        `💳 Payment form received, form ID: ${paymentForm.formId}`,
      );

      // Send payment - this will deduct stars from bot's account and send the gift
      const paymentResult = await this.client.invoke(
        new Api.payments.SendPaymentForm({
          formId: paymentForm.formId,
          invoice: invoice,
          credentials: new Api.InputPaymentCredentials({
            // For star gifts, we use empty credentials as payment is via Telegram Stars
            data: new Api.DataJSON({ data: '{}' }),
          }),
        }),
      );

      this.logger.log(
        `✅ Gift purchased and sent successfully to ${targetTelegramId}!`,
      );

      return {
        success: true,
        message: `Gift (catalogId: ${starGiftId}) purchased for ${validation.stars} stars and sent to user ${targetTelegramId}`,
        starsCost: validation.stars,
        result: paymentResult,
      };
    } catch (error) {
      this.logger.error(
        `Failed to buy/send gift to user ${targetTelegramId}:`,
        error,
      );
      throw new HttpException(
        `Failed to send gift: ${error.message}`,
        error.code === 400 ? 400 : 500,
      );
    }
  }

  /**
   * Validate if a gift can be purchased and sent
   * Checks: sold out, locked until date, premium required, per-user limits
   */
  async validateGiftCanBeSent(starGiftId: string): Promise<{
    canSend: boolean;
    reason?: string;
    stars?: number;
    giftInfo?: any;
  }> {
    if (!this.isInitialized) {
      throw new HttpException('Telegram UserBot not initialized', 500);
    }

    try {
      this.logger.log(`🔍 Validating gift ${starGiftId}...`);

      // Get all available gifts to find this one
      const giftsResult = await this.client.invoke(
        new Api.payments.GetStarGifts({ hash: 0 }),
      );

      if (giftsResult.className === 'payments.StarGiftsNotModified') {
        return { canSend: false, reason: 'Could not fetch gift catalog' };
      }

      const gifts = (giftsResult as any).gifts || [];
      const gift = gifts.find((g: any) => g.id?.toString() === starGiftId);

      if (!gift) {
        return {
          canSend: false,
          reason: `Gift with ID ${starGiftId} not found in catalog`,
        };
      }

      // Check if sold out
      if (gift.soldOut) {
        return {
          canSend: false,
          reason: 'Gift is sold out',
          giftInfo: gift,
        };
      }

      // Check if locked until a future date
      if (gift.lockedUntilDate) {
        const lockedUntil = new Date(gift.lockedUntilDate * 1000);
        if (lockedUntil > new Date()) {
          return {
            canSend: false,
            reason: `Gift is locked until ${lockedUntil.toISOString()}`,
            giftInfo: gift,
          };
        }
      }

      // Check per-user limits
      if (
        gift.limitedPerUser &&
        gift.perUserRemains !== undefined &&
        gift.perUserRemains <= 0
      ) {
        return {
          canSend: false,
          reason: 'Per-user purchase limit reached for this gift type',
          giftInfo: gift,
        };
      }

      // Check if requires premium (bot needs to have premium if this is set)
      if (gift.requirePremium) {
        this.logger.warn(
          'Gift requires Telegram Premium - ensure bot account has Premium',
        );
      }

      return {
        canSend: true,
        stars: gift.stars,
        giftInfo: {
          id: gift.id?.toString(),
          stars: gift.stars,
          limited: gift.limited || false,
          availabilityRemains: gift.availabilityRemains,
          availabilityTotal: gift.availabilityTotal,
          convertStars: gift.convertStars,
        },
      };
    } catch (error) {
      this.logger.error(`Failed to validate gift ${starGiftId}:`, error);
      return {
        canSend: false,
        reason: `Validation error: ${error.message}`,
      };
    }
  }

  /**
   * @deprecated Use buyAndSendGiftToUser instead
   */
  async sendStarGiftToUser(
    targetTelegramId: string,
    starGiftId: string,
    options: {
      message?: string;
      hideName?: boolean;
      includeUpgrade?: boolean;
    } = {},
  ): Promise<any> {
    return this.buyAndSendGiftToUser(targetTelegramId, starGiftId, options);
  }

  /**
   * Get saved gifts for the current user (bot account)
   * Useful for viewing what gifts the bot has received
   */
  async getSavedGifts(limit = 50, offset = ''): Promise<any> {
    if (!this.isInitialized) {
      throw new HttpException('Telegram UserBot not initialized', 500);
    }

    try {
      this.logger.log('Fetching saved gifts...');

      const me = await this.client.getMe();
      const myPeer = await this.client.getInputEntity((me as any).id);

      const result = await this.client.invoke(
        new Api.payments.GetSavedStarGifts({
          peer: myPeer,
          limit: limit,
          offset: offset,
        }),
      );

      const savedGifts = result as any;
      this.logger.log(`Found ${savedGifts.gifts?.length || 0} saved gifts`);

      return {
        success: true,
        gifts: savedGifts.gifts || [],
        nextOffset: savedGifts.nextOffset,
        count: savedGifts.count,
      };
    } catch (error) {
      this.logger.error('Failed to get saved gifts:', error);
      throw new HttpException(
        `Failed to get saved gifts: ${error.message}`,
        500,
      );
    }
  }

  /**
   * Check if we can send a specific gift
   * Some gifts may have restrictions (locked_until_date, require_premium, etc.)
   */
  async checkCanSendGift(starGiftId: string): Promise<any> {
    if (!this.isInitialized) {
      throw new HttpException('Telegram UserBot not initialized', 500);
    }

    try {
      this.logger.log(`Checking if gift ${starGiftId} can be sent...`);

      // Check if CheckCanSendGift is available in the API
      if (!(Api.payments as any).CheckCanSendGift) {
        this.logger.warn(
          'CheckCanSendGift not available in current telegram library',
        );
        // Return optimistic result if method not available
        return {
          canSend: true,
          message: 'Gift check not available, assuming sendable',
          warning:
            'CheckCanSendGift API not available in current library version',
        };
      }

      const result = await this.client.invoke(
        new (Api.payments as any).CheckCanSendGift({
          giftId: bigInt(starGiftId),
        }),
      );

      const canSend = result.className === 'payments.CheckCanSendGiftResultOk';

      if (!canSend) {
        const failResult = result as any;
        return {
          canSend: false,
          reason: failResult.reason?.text || 'Unknown reason',
        };
      }

      return {
        canSend: true,
        message: 'Gift can be sent',
      };
    } catch (error) {
      this.logger.error(`Failed to check gift ${starGiftId}:`, error);
      throw new HttpException(`Failed to check gift: ${error.message}`, 500);
    }
  }

  /**
   * Convert a received star gift to Telegram Stars
   * This permanently destroys the gift and adds stars to balance
   * Note: Can only convert gifts received less than stargifts_convert_period_max seconds ago
   */
  async convertGiftToStars(savedMsgId: number): Promise<any> {
    if (!this.isInitialized) {
      throw new HttpException('Telegram UserBot not initialized', 500);
    }

    try {
      this.logger.log(`Converting gift (msgId: ${savedMsgId}) to stars...`);

      const starGiftInput = new Api.InputSavedStarGiftUser({
        msgId: savedMsgId,
      });

      const result = await this.client.invoke(
        new Api.payments.ConvertStarGift({
          stargift: starGiftInput,
        }),
      );

      this.logger.log('✅ Gift converted to stars successfully');

      return {
        success: true,
        message: 'Gift converted to Telegram Stars',
        result,
      };
    } catch (error) {
      this.logger.error('Failed to convert gift to stars:', error);
      throw new HttpException(`Failed to convert gift: ${error.message}`, 500);
    }
  }
}
