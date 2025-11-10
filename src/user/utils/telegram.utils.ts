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
  if (!initData) {
    throw new HttpException('initData is required', 400);
  }

  // Parse parameters manually to handle all encoding scenarios
  const params: Map<string, string> = new Map();
  let hash = '';

  // Split by & to get key-value pairs
  const pairs = initData.split('&');

  for (const pair of pairs) {
    const equalIndex = pair.indexOf('=');
    if (equalIndex === -1) continue;

    const key = pair.substring(0, equalIndex);
    const value = pair.substring(equalIndex + 1);

    if (key === 'hash') {
      hash = value;
    } else if (key === 'signature') {
      // Telegram may send a signature field - exclude it from validation
      continue;
    } else {
      // Store the value as-is (URL-encoded) for hash calculation
      params.set(key, value);
    }
  }

  if (!hash) {
    throw new HttpException('Hash is missing from initData', 400);
  }

  // Create the secret key using bot token
  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();

  // Create data check string: sorted keys with values, joined by newlines
  const sortedKeys = Array.from(params.keys()).sort();
  const dataCheckString = sortedKeys
    .map((key) => `${key}=${params.get(key)}`)
    .join('\n');

  // Calculate the hash
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

  // Parse the validated data
  const result: ParsedInitData = {
    user: {} as TelegramUser,
    auth_date: 0,
    hash,
  };

  params.forEach((value, key) => {
    if (key === 'user') {
      // Decode the URL-encoded JSON string and parse it
      result.user = JSON.parse(decodeURIComponent(value));
    } else if (key === 'auth_date') {
      result.auth_date = parseInt(value, 10);
    } else {
      // Decode other parameters
      result[key] = decodeURIComponent(value);
    }
  });

  // Validate auth_date is not too old (24 hours)
  const authDate = result.auth_date * 1000;
  const currentTime = Date.now();
  const maxAge = 24 * 60 * 60 * 1000;

  if (currentTime - authDate > maxAge) {
    throw new HttpException('Auth data is too old', 401);
  }

  return result;
}
