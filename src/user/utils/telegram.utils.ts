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

  // Decode the initData if it's URL-encoded (handle double encoding from frontend)
  let decodedInitData = initData;
  try {
    // Check if the string is URL-encoded by looking for % characters
    if (initData.includes('%')) {
      decodedInitData = decodeURIComponent(initData);
    }
  } catch (error) {
    // If decoding fails, use the original string
    decodedInitData = initData;
  }

  // Parse the URL search params
  const urlParams = new URLSearchParams(decodedInitData);
  const hash = urlParams.get('hash');

  if (!hash) {
    throw new HttpException('Hash is missing from initData', 400);
  }

  // Remove hash and signature from params for validation
  urlParams.delete('hash');
  urlParams.delete('signature');

  // Create the secret key using bot token
  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();

  // Create data check string: sorted keys with values, joined by newlines
  // Important: URLSearchParams.toString() returns properly encoded values
  const dataCheckArray: string[] = [];

  // Sort parameters alphabetically and build data check string
  const sortedKeys = Array.from(urlParams.keys()).sort();
  for (const key of sortedKeys) {
    const value = urlParams.get(key);
    if (value !== null) {
      dataCheckArray.push(`${key}=${value}`);
    }
  }

  const dataCheckString = dataCheckArray.join('\n');

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

  // Re-parse with hash included for data extraction
  const allParams = new URLSearchParams(decodedInitData);

  allParams.forEach((value, key) => {
    if (key === 'user') {
      // Parse the user JSON
      result.user = JSON.parse(value);
    } else if (key === 'auth_date') {
      result.auth_date = parseInt(value, 10);
    } else if (key !== 'hash' && key !== 'signature') {
      result[key] = value;
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
