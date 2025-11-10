# Provably Fair Aviator System

## Overview

The Aviator game uses a **provably fair** algorithm based on HMAC-SHA256 cryptography. This ensures that game outcomes are predetermined and verifiable, preventing manipulation by either the server or players.

## How It Works

### Components

1. **Server Seed**: A secret 64-character hex string stored on the server (admin-controlled)
2. **Client Seed**: A random 32-character hex string generated for each game round
3. **Nonce**: An incrementing counter starting from 1 for each game round
4. **Multiplier**: The crash point calculated using the above inputs

### Algorithm

The crash multiplier is calculated using the following steps:

```
1. Generate HMAC-SHA256 hash:
   hash = HMAC-SHA256(serverSeed, "clientSeed:nonce")

2. Check for instant crash (1% probability by default):
   - If hash is divisible by 100, return 1.00x (instant crash)

3. Generate uniform random value U ∈ (0, 1):
   - Take top 52 bits of hash for precision
   - U = top52bits / 2^52

4. Apply inverse distribution:
   - K = targetRtp × (1 - instantCrashP)
   - multiplier = K / U

5. Apply boundaries:
   - Clamp between minMultiplier (1.00) and maxMultiplier (100000)
   - Round to 2 decimal places
```

### Settings

Configurable parameters (admin-only):

- **targetRtp**: Target Return to Player ratio (default: 0.89 = 89%)
- **instantCrashP**: Probability of instant crash at 1.00x (default: 0.01 = 1%)
- **minMultiplier**: Minimum crash point (default: 1.00)
- **maxMultiplier**: Maximum crash point (default: 100000)
- **minBet**: Minimum bet amount (default: 25 coins)
- **maxBet**: Maximum bet amount (default: 10000 coins)

## Verification

Players can verify game fairness by:

1. **Before the game**: Note the client seed (visible in game data)
2. **After the game**: Get the server seed, client seed, and nonce
3. **Calculate**: Use the algorithm to independently calculate the multiplier
4. **Compare**: Verify it matches the actual game result

### Using the Verification Script

The easiest way to verify a game is using the included verification script:

```bash
cd telegram-casino-backend
node scripts/verify-game.js <serverSeed> <clientSeed> <nonce> [targetRtp] [instantCrashP]
```

**Example**:

```bash
node scripts/verify-game.js \
  a3f8b9c2d1e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0 \
  b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6 \
  42 \
  0.89 \
  0.01
```

**Output**:

```
🔍 Provably Fair Aviator - Game Verification
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Server Seed:       a3f8b9c2d1e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0
Client Seed:       b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6
Nonce:             42
Target RTP:        89%
Instant Crash P:   1%
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 Calculation Steps:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Message: "b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6:42"
2. HMAC-SHA256 Hash: ...
3. Instant Crash Check: NO
4. Uniform Random Value (U): 0.123456
5. Calibration Coefficient (K): 0.8811
6. Raw Multiplier: 7.14
7. After Clamping: 7.14
8. Final Multiplier: 7.14x
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Verification Complete!

🎯 Final Result: 7.14x
```

### Verification Example (TypeScript)

```typescript
import * as crypto from 'crypto';

function verifyGame(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  targetRtp = 0.89,
  instantCrashP = 0.01,
) {
  // 1. Generate hash
  const message = `${clientSeed}:${nonce}`;
  const hash = crypto
    .createHmac('sha256', serverSeed)
    .update(message)
    .digest('hex');

  // 2. Check instant crash
  if (isDivisible(hash, 100)) {
    return 1.0;
  }

  // 3. Generate uniform value
  const top52Hex = hash.substring(0, 13);
  const top52 = parseInt(top52Hex, 16);
  const U = top52 / Math.pow(2, 52);

  // 4. Calculate multiplier
  const K = targetRtp * (1 - instantCrashP);
  let multiplier = K / Math.max(U, 1e-12);

  // 5. Apply boundaries and round
  multiplier = Math.max(1.0, Math.min(100000, multiplier));
  return Math.round(multiplier * 100) / 100;
}

function isDivisible(hash: string, mod: number): boolean {
  let val = 0;
  for (let i = 0; i < hash.length; i += 4) {
    const chunk = hash.substring(i, Math.min(i + 4, hash.length));
    val = ((val << 16) + parseInt(chunk, 16)) % mod;
  }
  return val === 0;
}
```

## Admin Endpoints

### Get Current Settings

```
GET /admin/aviator/settings
Authorization: Bearer <admin-token>
```

Response:

```json
{
  "settings": {
    "minMultiplier": 1.0,
    "maxMultiplier": 100000,
    "minBet": 25,
    "maxBet": 10000,
    "targetRtp": 0.89,
    "instantCrashP": 0.01
  },
  "timestamp": "2025-11-10T12:00:00.000Z"
}
```

### Update Settings

```
PUT /admin/aviator/settings
Authorization: Bearer <admin-token>
Content-Type: application/json

{
  "minMultiplier": 1.0,
  "maxMultiplier": 100000,
  "minBet": 25,
  "maxBet": 10000,
  "targetRtp": 0.89,
  "instantCrashP": 0.01
}
```

### Get Server Seed

```
GET /admin/aviator/server-seed
Authorization: Bearer <admin-token>
```

Response:

```json
{
  "serverSeed": "a3f8b9c2d1e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0",
  "timestamp": "2025-11-10T12:00:00.000Z"
}
```

### Update Server Seed

```
PUT /admin/aviator/server-seed
Authorization: Bearer <admin-token>
Content-Type: application/json

{
  "serverSeed": "a3f8b9c2d1e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0"
}
```

**Note**: Changing the server seed will affect all future games. Players should be notified when this happens for transparency.

## Database Schema

### Aviator Model

```prisma
model Aviator {
  id          Int           @id @default(autoincrement())
  startsAt    DateTime
  multiplier  Decimal
  status      AviatorStatus @default(ACTIVE)
  clientSeed  String?
  nonce       Int           @default(0)

  bets Bet[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

### System Variables

- `AVIATOR_SERVER_SEED`: The server seed (64 hex chars)
- `AVIATOR`: JSON settings object

## Security Considerations

1. **Server Seed Security**: The server seed must be kept secret until after games are completed
2. **Nonce Increment**: Each game increments the nonce to ensure unique outcomes
3. **Client Seed Randomness**: Client seeds are generated using cryptographically secure random bytes
4. **Verification Window**: Consider implementing a time window after which server seeds are publicly disclosed
5. **Seed Rotation**: Periodically rotate server seeds and notify players for transparency

## Migration

To apply the schema changes, run:

```bash
yarn prisma migrate dev --name add_provably_fair_fields
yarn prisma generate
```

This will:

1. Add `clientSeed` and `nonce` fields to the Aviator table
2. Add `AVIATOR_SERVER_SEED` to SystemKey enum
3. Regenerate Prisma Client with new types
