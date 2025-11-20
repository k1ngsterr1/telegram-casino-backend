# Referral System Documentation

## Overview

The referral system allows users to invite friends and earn commissions on their deposits. The system supports two entry points:

1. **Bot Link**: Users can share a referral link that opens the bot with a referral code
2. **Web App**: Users can share a web app link with a start parameter containing the referral code

## How It Works

### Referral Link Format

**Bot Link:**

```
https://t.me/YourBot?start=ref_USER_ID
```

**Example:**

```
https://t.me/YourBot?start=ref_c354c4c4-f424-469b-8a1b-6eb690112f2d
```

### Commission Structure

- **First Deposit**: Referrer receives **10%** of the deposit amount in XTR (Telegram Stars)
- **Subsequent Deposits**: Referrer receives **3%** of each deposit in XTR

### Referral Flow

1. **User A** gets their referral link via `GET /user/referral/link`
2. **User B** clicks the referral link
3. Two scenarios:
   - **Scenario 1 (Bot)**: User B opens bot with `/start ref_USER_A_ID`
   - **Scenario 2 (Web App)**: User B opens web app with `start_param=ref_USER_A_ID` in initData
4. Backend validates:
   - User B is not trying to refer themselves
   - Referrer (User A) exists in the database
   - User B doesn't already have a referrer (can only be referred once)
5. User B's `referredBy` field is set to User A's ID
6. When User B makes a deposit:
   - Payment is processed
   - `ReferralService.processDepositReferrals()` is called
   - Commission is calculated based on deposit count
   - Referrer's balance is updated
   - `ReferralEarning` record is created

## API Endpoints

### Get Referral Link

```
GET /user/referral/link
```

**Authorization**: Required (JWT)

**Response:**

```json
{
  "referralLink": "https://t.me/YourBot?start=ref_c354c4c4-f424-469b-8a1b-6eb690112f2d",
  "referralCode": "ref_c354c4c4-f424-469b-8a1b-6eb690112f2d"
}
```

### Get Referral Statistics

```
GET /user/referral/stats
```

**Authorization**: Required (JWT)

**Response:**

```json
{
  "totalReferrals": 5,
  "totalEarnings": 150,
  "firstDepositEarnings": 120,
  "subsequentDepositEarnings": 30,
  "activeReferrals": 3
}
```

### Get Referral Earnings History

```
GET /user/referral/earnings?page=1&limit=20
```

**Authorization**: Required (JWT)

**Query Parameters:**

- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 20)

**Response:**

```json
{
  "data": [
    {
      "id": 1,
      "referredUserId": "user-id",
      "amount": 10,
      "percentage": 0.1,
      "isFirstDeposit": true,
      "createdAt": "2025-01-01T00:00:00.000Z"
    }
  ],
  "total": 1
}
```

## Database Schema

### User Model

```prisma
model User {
  id           String          @id @default(uuid())
  telegramId   String          @unique

  // Referral field
  referredBy      String?         // ID of user who referred this user

  referralEarnings  ReferralEarning[]   @relation("ReferrerEarnings")
  referralSources   ReferralEarning[]   @relation("ReferredUserPayments")

  @@index([referredBy])
}
```

### ReferralEarning Model

```prisma
model ReferralEarning {
  id              Int     @id @default(autoincrement())
  referrerId      String  // User who earned the referral commission
  referredUserId  String  // User who made the deposit
  paymentId       String  // Payment that triggered the commission
  amount          Decimal // Commission amount in XTR
  percentage      Decimal // Commission percentage (0.10 or 0.03)
  isFirstDeposit  Boolean // Whether this was from the first deposit

  referrer      User    @relation("ReferrerEarnings", fields: [referrerId], references: [id])
  referredUser  User    @relation("ReferredUserPayments", fields: [referredUserId], references: [id])
  payment       Payment @relation("PaymentReferrals", fields: [paymentId], references: [id])

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([referrerId, createdAt])
  @@index([referredUserId, createdAt])
  @@index([paymentId])
}
```

## Implementation Details

### Bot Service (bot.service.ts)

The bot's `/start` command handles referral codes:

```typescript
// Extract referral code from /start command
// Format: /start ref_USERID
const startPayload = ctx.match;
let referrerId: string | null = null;

if (startPayload && typeof startPayload === 'string') {
  const parts = startPayload.trim().split('_');
  if (parts[0] === 'ref' && parts[1]) {
    referrerId = parts[1];
  }
}

// Set referrer if valid
if (shouldSetReferrer) {
  await prisma.user.upsert({
    where: { telegramId: telegramId.toString() },
    update: { referredBy: referrerId },
    create: {
      telegramId: telegramId.toString(),
      username: username,
      languageCode: languageCode,
      referredBy: referrerId,
    },
  });
}
```

### User Service (user.service.ts)

The telegram authentication method handles referral codes from `start_param`:

```typescript
// Extract referral code from start_param
// Format: ref_USERID (from Telegram initData)
let referrerId: string | null = null;
if (parsedData.start_param) {
  const parts = parsedData.start_param.trim().split('_');
  if (parts[0] === 'ref' && parts[1]) {
    referrerId = parts[1];
  }
}

// Validate and set referrer
// User can only be referred once
// Cannot refer themselves
```

### Referral Service (referral.service.ts)

Processes referral commissions when a user makes a deposit:

```typescript
async processDepositReferrals(
  userId: string,
  depositAmountInXTR: number,
): Promise<{ referral: ReferralReward | null }> {
  // Check if user has a referrer
  // Determine if this is first or subsequent deposit
  // Calculate commission (10% or 3%)
  // Return commission details for processing
}
```

### Payment Processing

When a Telegram Stars payment is completed:

```typescript
// 1. Update payment status and user balance
const payment = await prisma.$transaction(async (tx) => {
  const payment = await tx.payment.update({
    where: { id: paymentId },
    data: { status: PaymentStatus.COMPLETED },
  });
  await tx.user.update({
    where: { id: payment.userId },
    data: { balance: { increment: payment.amount } },
  });
  return payment;
});

// 2. Process referral commission
const referralReward = await referralService.processDepositReferrals(
  payment.userId,
  payment.amount.toNumber(),
);

// 3. Update referrer balance and create earning record
if (referralReward.referral) {
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: reward.referrerId },
      data: { balance: { increment: reward.amount } },
    });
    await tx.referralEarning.create({
      data: {
        referrerId: reward.referrerId,
        referredUserId: reward.referredUserId,
        paymentId: paymentId,
        amount: reward.amount,
        percentage: reward.percentage,
        isFirstDeposit: reward.isFirstDeposit,
      },
    });
  });
}
```

## Validation Rules

1. **Self-Referral Prevention**: Users cannot refer themselves
2. **Single Referrer**: Users can only be referred once (first valid referral link wins)
3. **Existing User Update**: If a user exists without a referrer, a valid referral code can still set their referrer
4. **Referrer Must Exist**: The referrer user ID must exist in the database
5. **Commission Calculation**: Only completed payments trigger referral commissions

## Frontend Integration

### Web App Integration

When opening the web app with a referral code:

```javascript
// Telegram Web App sends initData to backend
// initData includes start_param if user came from referral link

const initData = window.Telegram.WebApp.initData;

// Send to backend
fetch('/user/telegram', {
  method: 'POST',
  body: JSON.stringify({ initData }),
  headers: { 'Content-Type': 'application/json' },
});
```

### Sharing Referral Link

```javascript
// Get referral link from backend
const response = await fetch('/user/referral/link', {
  headers: { Authorization: `Bearer ${token}` },
});

const { referralLink } = await response.json();

// Share via Telegram
window.Telegram.WebApp.openTelegramLink(referralLink);
```

## Testing

1. **Get referral link** for User A:

   ```bash
   curl -X GET http://localhost:3000/user/referral/link \
     -H "Authorization: Bearer USER_A_TOKEN"
   ```

2. **User B clicks link** and authenticates:
   - Bot: `/start ref_USER_A_ID`
   - Web App: Opens with `start_param=ref_USER_A_ID`

3. **Verify referral** was set:

   ```sql
   SELECT id, telegramId, referredBy FROM "User" WHERE telegramId = 'USER_B_TELEGRAM_ID';
   ```

4. **User B makes a deposit** (Telegram Stars)

5. **Check referral earnings**:
   ```bash
   curl -X GET http://localhost:3000/user/referral/stats \
     -H "Authorization: Bearer USER_A_TOKEN"
   ```

## Notes

- Referral system only works for XTR (Telegram Stars) payments currently
- TON payments do not trigger referral commissions (can be added if needed)
- Referral earnings are automatically added to the referrer's balance
- All commission calculations use integer math to avoid rounding issues with Telegram Stars
