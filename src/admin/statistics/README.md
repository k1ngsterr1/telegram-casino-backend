# Admin Statistics Module

This module provides comprehensive analytics and transaction tracking for the casino backend.

## Endpoints

### GET `/admin/statistics/analytics`

Returns key metrics and revenue analytics.

**Query Parameters:**

- `startDate` (optional): ISO 8601 date string for start of period
- `endDate` (optional): ISO 8601 date string for end of period

**Response:**

```json
{
  "metrics": {
    "userGrowthPercentage": 12.5,
    "averageCheck": 2850,
    "activityPercentage": 57.6,
    "retentionPercentage": 68.2
  },
  "dailyRevenue": [
    {
      "day": "Пн",
      "revenue": 350000,
      "payout": 70000,
      "profit": 280000
    }
    // ... more days
  ],
  "totalUsers": 1543,
  "activeUsers": 889,
  "totalRevenue": 3760000,
  "totalPayouts": 645000,
  "totalProfit": 3115000
}
```

**Metrics Explained:**

- **userGrowthPercentage**: Percentage change in new users compared to previous period
- **averageCheck**: Average revenue per active player
- **activityPercentage**: Percentage of total users who are active (made bets/opened cases)
- **retentionPercentage**: Percentage of users who return after 7 days
- **dailyRevenue**: Revenue, payouts, and profit for each day in the period (max 7 days)

### GET `/admin/statistics/transactions`

Returns paginated list of all transactions.

**Query Parameters:**

- `page` (optional, default: 1): Page number
- `limit` (optional, default: 20): Items per page
- `startDate` (optional): ISO 8601 date string for filtering
- `endDate` (optional): ISO 8601 date string for filtering

**Response:**

```json
{
  "data": [
    {
      "id": "bet_123",
      "user": "user_john_doe",
      "type": "Ставка",
      "game": "Aviator",
      "amount": 23301,
      "status": "В обработке",
      "date": "2025-11-05T17:21:00.000Z"
    }
    // ... more transactions
  ],
  "meta": {
    "total": 150,
    "page": 1,
    "limit": 20,
    "totalPages": 8
  }
}
```

**Transaction Types:**

- `Ставка` (Bet): User placed a bet
- `Пополнение` (Deposit): User deposited funds
- `Вывод` (Withdrawal): User withdrew funds
- `Выигрыш` (Win): User won a prize

**Transaction Status:**

- `В обработке` (Pending): Transaction is being processed
- `Выполнено` (Completed): Transaction completed successfully
- `Ошибка` (Failed): Transaction failed

### GET `/admin/statistics/leaderboard`

Returns top 5 players by bets and winnings.

**Query Parameters:**

- `startDate` (optional): ISO 8601 date string for start of period
- `endDate` (optional): ISO 8601 date string for end of period

**Response:**

```json
{
  "topBettors": [
    {
      "rank": 1,
      "user": "@user_12345",
      "amount": 450000
    },
    {
      "rank": 2,
      "user": "@user_67890",
      "amount": 380000
    }
    // ... up to 5 players
  ],
  "topWinners": [
    {
      "rank": 1,
      "user": "@user_99887",
      "amount": 520000
    },
    {
      "rank": 2,
      "user": "@user_66554",
      "amount": 480000
    }
    // ... up to 5 players
  ]
}
```

**Leaderboard Explanation:**

- **topBettors**: Players ranked by total bet amount (sum of all bets)
- **topWinners**: Players ranked by total winnings (cashouts + prize amounts)

## Authorization

All endpoints require:

- Valid JWT token in `Authorization: Bearer <token>` header
- User role must be `ADMIN`

## Revenue Calculation

Revenue is calculated from three sources:

1. **Case openings**: Sum of case prices
2. **Aviator bets**: Sum of all bet amounts
3. **Completed deposits**: Sum of all completed payment amounts

Payouts include:

1. **Prize winnings**: Sum of prize amounts from opened cases
2. **Aviator cashouts**: Sum of cashed out bet amounts (bet amount × multiplier)

Profit = Revenue - Payouts

## Usage Example

```typescript
// Get analytics for last 7 days
GET /admin/statistics/analytics

// Get analytics for specific date range
GET /admin/statistics/analytics?startDate=2025-11-01T00:00:00.000Z&endDate=2025-11-10T23:59:59.999Z

// Get first page of transactions
GET /admin/statistics/transactions?page=1&limit=20

// Get filtered transactions
GET /admin/statistics/transactions?startDate=2025-11-01T00:00:00.000Z&page=1&limit=50

// Get leaderboard for last 7 days
GET /admin/statistics/leaderboard

// Get leaderboard for specific date range
GET /admin/statistics/leaderboard?startDate=2025-11-01T00:00:00.000Z&endDate=2025-11-10T23:59:59.999Z
```
