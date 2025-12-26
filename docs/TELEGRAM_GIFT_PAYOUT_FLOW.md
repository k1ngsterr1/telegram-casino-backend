# Telegram Gift Payout Flow

This document describes the complete flow for how users receive Telegram gifts through the casino platform.

## Overview

The gift system allows users to:
1. Send gifts to the casino bot
2. Have gifts added to their inventory
3. Request payout of gifts back to their Telegram account
4. Receive the actual gift purchased and sent by the bot

## Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         TELEGRAM GIFT PAYOUT FLOW                           │
└─────────────────────────────────────────────────────────────────────────────┘

User sends gift to bot          Bot receives & stores gift
        │                                │
        ▼                                ▼
┌───────────────┐              ┌─────────────────────┐
│  Telegram     │───────────►  │  Gift saved with    │
│  Gift sent    │              │  status: PENDING    │
└───────────────┘              │  starGiftId stored  │
                               └─────────────────────┘
                                         │
                                         ▼
                               ┌─────────────────────┐
                               │  Admin converts to  │
                               │  inventory item     │
                               │  status: IN_INVENTORY│
                               └─────────────────────┘
                                         │
                                         ▼
                               ┌─────────────────────┐
                               │  User requests      │
                               │  payout via API     │
                               │  status: PAYOUT_    │
                               │  REQUESTED          │
                               └─────────────────────┘
                                         │
                                         ▼
                               ┌─────────────────────┐
                               │  Admin approves     │
                               │  payout             │
                               │  status: PAYOUT_    │
                               │  APPROVED           │
                               └─────────────────────┘
                                         │
                                         ▼
                               ┌─────────────────────┐
                               │  Bot PURCHASES new  │
                               │  gift from Telegram │
                               │  marketplace        │
                               └─────────────────────┘
                                         │
                                         ▼
                               ┌─────────────────────┐
                               │  Gift sent to user  │
                               │  status: PAID_OUT   │
                               └─────────────────────┘
```

---

## Status Flow

| Status | Description |
|--------|-------------|
| `PENDING` | Gift received by bot, not yet processed |
| `IN_INVENTORY` | Gift converted to user's casino inventory |
| `PAYOUT_REQUESTED` | User requested to receive the gift in Telegram |
| `PAYOUT_APPROVED` | Admin approved, purchase in progress |
| `PAID_OUT` | Gift successfully purchased and sent to user |
| `SOLD` | User sold the gift for balance (alternative path) |
| `FAILED` | Payout/transfer failed |

---

## API Endpoints

### 1. Gift Reception (Automatic)

The bot automatically receives gifts via the Telegram userbot service. When a user sends a gift to the bot:

- **Service:** `TelegramUserbotService.processGiftMessage()`
- **What happens:**
  - Gift details extracted (type, stars value, NFT info)
  - `starGiftId` stored (catalog ID for purchasing same type later)
  - Gift saved with status `PENDING`

### 2. Get User's Gifts

**Endpoint:** `GET /gift/user/:telegramId`

**Description:** Get all gifts for a specific user

**Response:**
```json
{
  "gifts": [
    {
      "id": 1,
      "giftType": "STAR_GIFT",
      "starsValue": 100,
      "status": "IN_INVENTORY",
      "starGiftId": "5000000001",
      "receivedAt": "2024-12-26T10:00:00Z"
    }
  ],
  "totalCount": 1,
  "hasMore": false
}
```

### 3. Convert Gift to Inventory (Admin)

**Endpoint:** `POST /admin/gift/convert-to-inventory`

**Description:** Admin converts a pending gift to user's inventory

**Request Body:**
```json
{
  "giftId": 1,
  "userId": "user-uuid-here"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Gift converted to inventory successfully",
  "data": {
    "inventoryItem": { "id": 1, "userId": "...", "prizeId": 1 },
    "prize": { "id": 1, "name": "Telegram Gift #1", "amount": 100 },
    "gift": { "id": 1, "status": "IN_INVENTORY" }
  }
}
```

### 4. Request Payout (User)

**Endpoint:** `POST /gift/request-payout`

**Description:** User requests to receive a gift in their Telegram account

**Request Body:**
```json
{
  "giftId": 1,
  "targetTelegramId": "123456789"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Payout request submitted successfully",
  "data": {
    "id": 1,
    "status": "PAYOUT_REQUESTED",
    "payoutToTelegramId": "123456789"
  }
}
```

**Validations:**
- Gift must be in `IN_INVENTORY` status
- Gift must have `starGiftId` or `starGiftSlug` for purchasing

### 5. Get Pending Payout Requests (Admin)

**Endpoint:** `GET /admin/gift/payout-requests`

**Description:** Get all gifts awaiting payout approval

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "giftType": "STAR_GIFT",
      "starsValue": 100,
      "status": "PAYOUT_REQUESTED",
      "payoutToTelegramId": "123456789",
      "starGiftId": "5000000001",
      "user": {
        "id": "user-uuid",
        "username": "john_doe",
        "telegramId": "123456789"
      }
    }
  ]
}
```

### 6. Validate Gift Before Approval (Admin)

**Endpoint:** `POST /admin/gift/validate-gift`

**Description:** Check if a gift can still be purchased from Telegram marketplace

**Request Body:**
```json
{
  "starGiftId": "5000000001"
}
```

**Response (Success):**
```json
{
  "success": true,
  "message": "Gift can be sent",
  "data": {
    "canSend": true,
    "starGiftId": "5000000001",
    "starsRequired": 100,
    "availabilityRemaining": 5000
  }
}
```

**Response (Unavailable):**
```json
{
  "success": false,
  "message": "Gift cannot be sent: Gift is sold out",
  "data": {
    "canSend": false,
    "reason": "Gift is sold out"
  }
}
```

### 7. Approve Payout (Admin)

**Endpoint:** `POST /admin/gift/approve-payout`

**Description:** Admin approves payout - bot purchases and sends gift to user

**Request Body:**
```json
{
  "giftId": 1
}
```

**Response (Success):**
```json
{
  "success": true,
  "message": "Gift payout approved and sent successfully",
  "data": {
    "giftId": 1,
    "status": "PAID_OUT",
    "targetTelegramId": "123456789"
  }
}
```

**What happens internally:**
1. Validates gift is in `PAYOUT_REQUESTED` status
2. Checks gift availability via `validateGiftCanBeSent()`
3. Updates status to `PAYOUT_APPROVED`
4. Calls `buyAndSendGiftToUser()` which:
   - Creates payment form via Telegram API
   - Purchases gift using bot's stars
   - Sends gift to target user
5. Updates status to `PAID_OUT` on success or `FAILED` on error

### 8. Get Available Star Gifts (Admin)

**Endpoint:** `GET /admin/gift/available-star-gifts`

**Description:** Get all gifts available for purchase from Telegram marketplace

**Response:**
```json
{
  "success": true,
  "data": {
    "gifts": [
      {
        "id": "5000000001",
        "stars": 100,
        "availabilityRemaining": 5000,
        "availabilityTotal": 10000,
        "soldOut": false
      }
    ],
    "count": 50
  }
}
```

### 9. Send Gift Directly (Admin)

**Endpoint:** `POST /admin/gift/send-gift-direct`

**Description:** Purchase and send a gift directly without existing gift record

**Request Body:**
```json
{
  "targetTelegramId": "123456789",
  "starGiftId": "5000000001"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Gift sent successfully",
  "data": {
    "targetTelegramId": "123456789",
    "starGiftId": "5000000001"
  }
}
```

---

## Complete User Journey Example

### Step 1: User Sends Gift to Bot
```
User opens Telegram → Sends a Star Gift (100 stars) to @CasinoBot
```

### Step 2: Bot Processes Gift
```
Bot receives gift → Extracts starGiftId → Saves to database
Gift status: PENDING
```

### Step 3: Admin Adds to Inventory
```
Admin Panel → Gifts → Select gift → "Convert to Inventory"
POST /admin/gift/convert-to-inventory { giftId: 1, userId: "..." }
Gift status: IN_INVENTORY
```

### Step 4: User Plays and Wants Payout
```
User opens casino → Goes to inventory → Clicks "Withdraw" on gift
POST /gift/request-payout { giftId: 1, targetTelegramId: "123456789" }
Gift status: PAYOUT_REQUESTED
```

### Step 5: Admin Reviews Request
```
Admin Panel → Payout Requests → See pending request
GET /admin/gift/payout-requests
```

### Step 6: Admin Validates Availability
```
Admin Panel → Click "Validate" button
POST /admin/gift/validate-gift { starGiftId: "5000000001" }
Response: { canSend: true, starsRequired: 100 }
```

### Step 7: Admin Approves
```
Admin Panel → Click "Approve" button
POST /admin/gift/approve-payout { giftId: 1 }
- Bot purchases gift from Telegram (100 stars)
- Bot sends gift to user's Telegram
Gift status: PAID_OUT
```

### Step 8: User Receives Gift
```
User receives notification in Telegram
"You received a gift from @CasinoBot!"
```

---

## Error Handling

### Common Errors

| Error | Cause | Resolution |
|-------|-------|------------|
| "Gift not found" | Invalid gift ID | Check gift exists |
| "Gift is not in IN_INVENTORY status" | Wrong status for payout | Ensure gift is in inventory |
| "Gift is sold out" | Telegram marketplace sold out | Cannot fulfill, refund user |
| "Gift is locked and cannot be purchased" | Gift restricted | Cannot fulfill, refund user |
| "Insufficient stars balance" | Bot has no stars | Add stars to bot account |
| "No starGiftId available" | Missing catalog ID | Cannot determine which gift to buy |

### Failed Payout Recovery

If a payout fails:
1. Status changes to `FAILED`
2. `payoutError` field contains error message
3. Admin can retry or refund the user manually

---

## Important Notes

1. **Stars Balance:** The bot must have sufficient Telegram Stars to purchase gifts
2. **Gift Availability:** Some gifts are limited edition and may sell out
3. **Unique Gifts:** NFT/unique gifts use `starGiftSlug` instead of `starGiftId`
4. **Rate Limits:** Telegram may rate limit gift purchases
5. **Validation First:** Always validate gift availability before approving payout
