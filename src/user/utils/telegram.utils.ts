import { HttpException } from '@nestjs/common';
import * as crypto from 'crypto';

export interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  allows_write_to_pm?: boolean;
}

export interface ParsedInitData {
  user: TelegramUser;
  auth_date: number;
  hash: string;
  query_id?: string;
  [key: string]: any;
}

/**
 * Validates Telegram Web App initData
 * @param initData - The initData string from Telegram Web App
 * @param botToken - The bot token from Telegram
 * @returns Parsed data if valid, throws error if invalid
 */
export function validateTelegramWebAppData(
  initData: string,
  botToken: string,
): ParsedInitData {
  let decodedInitData = initData;
  if (initData.includes('%3D') || initData.includes('%26')) {
    decodedInitData = decodeURIComponent(initData);
  }

  const params: Map<string, string> = new Map();
  const pairs = decodedInitData.split('&');

  let hash = '';

  for (const pair of pairs) {
    const [key, ...valueParts] = pair.split('=');
    const value = valueParts.join('=');

    if (key === 'hash') {
      hash = value;
    } else if (key === 'signature') {
      // Telegram may send a signature field - exclude it from validation
      // The signature is used for other purposes and should not be part of hash calculation
      continue;
    } else {
      params.set(key, value);
    }
  }

  if (!hash) {
    throw new HttpException('Hash is missing from initData', 400);
  }

  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();

  const sortedKeys = Array.from(params.keys()).sort();
  const dataCheckString = sortedKeys
    .map((key) => `${key}=${params.get(key)}`)
    .join('\n');

  const calculatedHash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  if (calculatedHash !== hash) {
    // Add debugging info in development
    if (process.env.NODE_ENV !== 'production') {
      console.error('Hash validation failed:');
      console.error('Expected hash:', hash);
      console.error('Calculated hash:', calculatedHash);
      console.error('Data check string:', dataCheckString);
    }
    throw new HttpException('Invalid hash - data integrity check failed', 400);
  }

  const result: ParsedInitData = {
    user: {} as TelegramUser,
    auth_date: 0,
    hash,
  };

  params.forEach((value, key) => {
    if (key === 'user') {
      result.user = JSON.parse(decodeURIComponent(value));
    } else if (key === 'auth_date') {
      result.auth_date = parseInt(value, 10);
    } else {
      result[key] = decodeURIComponent(value);
    }
  });

  const authDate = result.auth_date * 1000;
  const currentTime = Date.now();
  const maxAge = 24 * 60 * 60 * 1000;

  if (currentTime - authDate > maxAge) {
    throw new HttpException('Auth data is too old', 401);
  }

  return result;
}
