# Free Case with Telegram Subscription Requirements

This feature allows you to configure free cases that require users to join specific Telegram groups/channels before they can open the case.

## How It Works

1. **Admin Configuration**: Admins can configure which Telegram groups/channels users must join
2. **User Verification**: When a user tries to open a free case, the system verifies their membership in all required groups/channels
3. **Real-time Status**: Users can check their subscription status at any time

## API Endpoints

### Admin Endpoints (require admin authentication)

#### Get Subscription Requirements
```
GET /admin/system/subscriptions/requirements
```

Returns the current list of required subscriptions with chat info.

**Response:**
```json
{
  "subscriptions": [
    {
      "chatId": "@mychannel",
      "title": "My Channel",
      "inviteLink": "https://t.me/mychannel",
      "chatInfo": {
        "id": -1001234567890,
        "title": "My Channel",
        "type": "channel",
        "username": "mychannel"
      }
    }
  ]
}
```

#### Update Subscription Requirements
```
PUT /admin/system/subscriptions/requirements
```

**Request Body:**
```json
{
  "subscriptions": [
    {
      "chatId": "@mychannel",
      "title": "My Channel",
      "inviteLink": "https://t.me/mychannel"
    },
    {
      "chatId": "-1001234567890",
      "title": "My Group",
      "inviteLink": "https://t.me/+abcd1234"
    }
  ]
}
```

**Note:** The bot must be added as an admin to all specified chats/channels for verification to work.

#### Verify Chat Access
```
POST /admin/system/subscriptions/verify
```

Test if the bot can access a specific chat.

**Request Body:**
```json
{
  "chatId": "@mychannel"
}
```

**Response:**
```json
{
  "isAccessible": true,
  "chatInfo": {
    "id": -1001234567890,
    "title": "My Channel",
    "type": "channel",
    "username": "mychannel"
  }
}
```

### User Endpoints (require user authentication)

#### Check Subscription Status
```
GET /case/subscriptions/status
```

Returns the user's subscription status for all required groups/channels.

**Response:**
```json
{
  "subscriptions": [
    {
      "chatId": "@mychannel",
      "title": "My Channel",
      "isSubscribed": true,
      "inviteLink": "https://t.me/mychannel"
    },
    {
      "chatId": "-1001234567890",
      "title": "My Group",
      "isSubscribed": false,
      "inviteLink": "https://t.me/+abcd1234"
    }
  ],
  "allSubscriptionsMet": false
}
```

#### Check Free Case Cooldown (Enhanced)
```
GET /case/:id/cooldown
```

Now includes subscription status in the response.

**Response:**
```json
{
  "canOpen": false,
  "secondsRemaining": null,
  "lastOpenedAt": null,
  "nextAvailableAt": null,
  "subscriptions": [
    {
      "chatId": "@mychannel",
      "title": "My Channel",
      "isSubscribed": true,
      "inviteLink": "https://t.me/mychannel"
    }
  ],
  "allSubscriptionsMet": true
}
```

**Note:** `canOpen` will be `false` if either:
- The cooldown hasn't expired yet
- Not all subscription requirements are met

## Setup Instructions

### 1. Add Bot to Groups/Channels

The bot must be added as an **administrator** to each group or channel you want to require users to join. This is necessary for the bot to check user membership.

For **channels**:
- Add the bot as an admin with at least "See members" permission

For **groups**:
- Add the bot as an admin (no special permissions needed beyond basic admin)

### 2. Get Chat IDs

You can use chat usernames (e.g., `@mychannel`) or numeric IDs (e.g., `-1001234567890`).

To get a chat's numeric ID:
1. Add `@userinfobot` to your group/channel
2. Forward any message from the group/channel to the bot
3. The bot will reply with the chat ID

### 3. Configure Requirements

Use the admin panel or API to configure the subscription requirements:

```bash
curl -X PUT "https://your-api.com/admin/system/subscriptions/requirements" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "subscriptions": [
      {
        "chatId": "@yourchannel",
        "title": "Our Official Channel",
        "inviteLink": "https://t.me/yourchannel"
      },
      {
        "chatId": "@yourchat",
        "title": "Our Community Chat",
        "inviteLink": "https://t.me/yourchat"
      }
    ]
  }'
```

### 4. Verify Setup

Test that everything works:

1. Use the verify endpoint to check bot access to each chat
2. Open the free case as a test user who is NOT subscribed - should get error
3. Subscribe to all required chats
4. Try again - should work

## Error Messages

When a user tries to open a free case without meeting subscription requirements:

```json
{
  "statusCode": 403,
  "message": "You must subscribe to the following to open this free case: My Channel, My Group"
}
```

## Frontend Integration

### Display Subscription Status

```typescript
interface SubscriptionRequirement {
  chatId: string;
  title: string;
  isSubscribed: boolean;
  inviteLink?: string;
}

// Fetch subscription status
const response = await fetch('/case/subscriptions/status', {
  headers: { Authorization: `Bearer ${token}` }
});
const { subscriptions, allSubscriptionsMet } = await response.json();

// Display to user
subscriptions.forEach(sub => {
  if (!sub.isSubscribed) {
    // Show "Subscribe" button with inviteLink
    console.log(`Please join ${sub.title}: ${sub.inviteLink}`);
  }
});
```

### Handle Free Case Opening

```typescript
async function openFreeCase(caseId: number) {
  // First check cooldown and subscription status
  const cooldownResponse = await fetch(`/case/${caseId}/cooldown`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const cooldown = await cooldownResponse.json();
  
  if (!cooldown.allSubscriptionsMet) {
    // Show subscription requirements
    const unsubscribed = cooldown.subscriptions
      .filter(s => !s.isSubscribed);
    
    showSubscriptionDialog(unsubscribed);
    return;
  }
  
  if (!cooldown.canOpen) {
    showCooldownTimer(cooldown.secondsRemaining);
    return;
  }
  
  // Open the case
  const result = await fetch(`/case/${caseId}/open`, {
    method: 'POST',
    headers: { 
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ multiplier: 1 })
  });
  
  // Handle result...
}
```

## Notes

- Subscription verification happens in real-time using the Telegram Bot API
- If the bot loses admin access to a chat, verification will fail (users won't be able to open free cases)
- Empty subscription list means no requirements (all users can open free cases)
- The 24-hour cooldown still applies even after subscription requirements are met
