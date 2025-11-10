# Upgrade System

The upgrade system allows users to upgrade their inventory items to higher-value prizes with different multipliers and success chances.

## Features

- **Multiple Multipliers**: Users can choose from x1.5, x2, x3, x5, or x10 multipliers
- **Configurable Chances**: Admins can set success rates for each multiplier
- **Provably Fair**: All upgrade attempts are recorded in the database
- **Automatic Inventory Management**: Items are automatically removed on failure and replaced on success

## Database Schema

### UpgradeChance
Stores the success chance for each multiplier:
- `multiplier`: Enum (X1_5, X2, X3, X5, X10)
- `chance`: Decimal (0.0 - 1.0)

### Upgrade
Records all upgrade attempts:
- `userId`: User who attempted the upgrade
- `fromPrizeId`: Source prize
- `toPrizeId`: Target prize (null if failed)
- `multiplier`: Multiplier used
- `chance`: Chance at the time of upgrade
- `success`: Boolean indicating success/failure

## User Endpoints

### GET `/upgrade/options`
Get available upgrade options for an inventory item.

**Query Parameters:**
- `inventoryItemId`: ID of the inventory item to upgrade

**Response:**
```json
{
  "sourcePrize": {
    "id": 1,
    "name": "Basic Item",
    "amount": 100,
    "url": "https://example.com/basic.png"
  },
  "options": [
    {
      "multiplier": "X2",
      "chance": 0.5,
      "targetPrize": {
        "id": 2,
        "name": "Premium Item",
        "amount": 200,
        "url": "https://example.com/premium.png"
      }
    }
  ]
}
```

### POST `/upgrade/execute`
Execute an upgrade attempt.

**Body:**
```json
{
  "inventoryItemId": 1,
  "multiplier": "X2"
}
```

**Response:**
```json
{
  "success": true,
  "multiplier": "X2",
  "chance": 0.5,
  "fromPrize": {
    "id": 1,
    "name": "Basic Item",
    "amount": 100,
    "url": "https://example.com/basic.png"
  },
  "toPrize": {
    "id": 2,
    "name": "Premium Item",
    "amount": 200,
    "url": "https://example.com/premium.png"
  },
  "newInventoryItemId": 42
}
```

## Admin Endpoints

### GET `/admin/upgrade/chances`
Get all configured upgrade chances.

**Response:**
```json
[
  {
    "id": 1,
    "multiplier": "X2",
    "chance": "0.5",
    "createdAt": "2025-11-10T12:00:00Z",
    "updatedAt": "2025-11-10T12:00:00Z"
  }
]
```

### PUT `/admin/upgrade/chance`
Update or create upgrade chance for a multiplier.

**Body:**
```json
{
  "multiplier": "X2",
  "chance": 0.5
}
```

### PUT `/admin/upgrade/initialize`
Initialize default upgrade chances:
- X1.5: 70% success
- X2: 50% success
- X3: 33% success
- X5: 20% success
- X10: 10% success

## How It Works

1. **User selects an item**: User queries `/upgrade/options` with an inventory item ID
2. **System calculates targets**: For each multiplier, the system finds the closest prize with `amount >= sourcePrize.amount * multiplier`
3. **User chooses multiplier**: User calls `/upgrade/execute` with chosen multiplier
4. **Random determination**: System generates random number and compares to configured chance
5. **Inventory update**:
   - **Success**: Old item deleted, new higher-value item added
   - **Failure**: Old item deleted, nothing added
6. **History recorded**: Upgrade attempt saved to database for transparency

## Setup Instructions

1. **Run migration** (after resolving database drift):
   ```bash
   yarn prisma migrate dev
   ```

2. **Initialize default chances** (recommended for first-time setup):
   ```bash
   curl -X PUT http://localhost:3000/admin/upgrade/initialize \
     -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
   ```

3. **Customize chances** (optional):
   ```bash
   curl -X PUT http://localhost:3000/admin/upgrade/chance \
     -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"multiplier": "X2", "chance": 0.6}'
   ```

## Important Notes

- The source inventory item is **always deleted**, whether the upgrade succeeds or fails
- Target prizes are automatically selected based on the multiplier and available prizes
- All upgrade attempts are recorded for audit purposes
- Chances are stored as decimals (0.0 - 1.0, where 1.0 = 100% success)
