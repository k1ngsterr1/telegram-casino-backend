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

// Import Telegram API (install: yarn add telegram)
// Note: These will be optional dependencies
let TelegramClient: any;
let StringSession: any;
let Api: any;

try {
  const telegram = require('telegram');
  TelegramClient = telegram.TelegramClient;
  StringSession = telegram.sessions.StringSession;
  Api = telegram.Api;
} catch (error) {
  // Telegram dependencies not installed - service will be disabled
}

@Injectable()
export class TelegramUserbotService implements OnModuleDestroy {
  private readonly logger = new Logger(TelegramUserbotService.name);
  private client: any = null;
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
        }
      } else {
        // Use existing session
        const connectPromise = this.client.connect();
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(
            () =>
              reject(new HttpException('Telegram client connect timeout', 500)),
            30000,
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
}
