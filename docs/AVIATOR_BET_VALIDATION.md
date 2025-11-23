# Валидация ставок в Aviator

## Серверная валидация (Backend)

### Проверки при размещении ставки

Backend выполняет следующие проверки в указанном порядке:

#### 1. Валидация суммы ставки

```typescript
// Проверка что сумма > 0
if (!amount || amount <= 0) {
  throw new HttpException('Bet amount must be greater than 0', 400);
}

// Проверка минимальной ставки (по умолчанию 25)
if (amount < minBet) {
  throw new HttpException(
    `Minimum bet amount is ${minBet}. You tried to bet ${amount}`,
    400,
  );
}

// Проверка максимальной ставки (по умолчанию 10000)
if (amount > maxBet) {
  throw new HttpException(
    `Maximum bet amount is ${maxBet}. You tried to bet ${amount}`,
    400,
  );
}
```

#### 2. Проверка существования игры

```typescript
const game = await this.prisma.aviator.findUnique({
  where: { id: aviatorId },
});

if (!game) {
  throw new HttpException('Aviator game not found', 404);
}
```

#### 3. Проверка статуса игры

```typescript
// Ставки принимаются только в статусе WAITING
if (game.status !== AviatorStatus.WAITING) {
  throw new HttpException('Game is not accepting bets', 400);
}

// Проверка что игра еще не началась
if (new Date() >= game.startsAt) {
  throw new HttpException('Game has already started, cannot place bet', 400);
}
```

#### 4. Проверка пользователя

```typescript
const user = await tx.user.findUnique({
  where: { id: userId },
  select: { id: true, balance: true, isBanned: true },
});

if (!user) {
  throw new HttpException('User not found', 404);
}

if (user.isBanned) {
  throw new HttpException('User is banned', 403);
}
```

#### 5. Проверка баланса (КРИТИЧНО!)

```typescript
const currentBalance = Number(user.balance);

if (currentBalance < amount) {
  this.logger.warn(
    `User ${userId} attempted to bet ${amount} with insufficient balance ${currentBalance}`,
  );

  throw new HttpException(
    `Insufficient balance. You have ${currentBalance}, but need ${amount}`,
    400,
  );
}
```

#### 6. Проверка дубликатов ставок

```typescript
const existingBet = await tx.bet.findFirst({
  where: {
    aviatorId: game.id,
    userId: userId,
  },
});

if (existingBet) {
  throw new HttpException('You already have a bet on this game', 400);
}
```

#### 7. Атомарное списание баланса (защита от race condition)

```typescript
// Atomic update with balance check
const updateResult = await tx.user.updateMany({
  where: {
    id: userId,
    balance: { gte: amount }, // Двойная проверка!
  },
  data: {
    balance: { decrement: amount },
  },
});

if (updateResult.count === 0) {
  // Это может произойти если баланс изменился между проверками
  this.logger.error(
    `Race condition: User ${userId} balance changed during transaction`,
  );

  throw new HttpException(
    'Insufficient balance. Your balance may have changed.',
    400,
  );
}
```

---

## Клиентская валидация (Frontend)

### Проверка перед отправкой ставки

```typescript
const placeBet = (amount: number) => {
  // 1. Проверка что пользователь авторизован
  if (!userId) {
    showError('Please log in to place a bet');
    return;
  }

  // 2. Проверка подключения к сокету
  if (!socket || !socket.connected) {
    showError('Not connected to server');
    return;
  }

  // 3. Проверка что игра в статусе WAITING
  if (gameStatus !== 'WAITING') {
    showError('Bets are only accepted before the game starts');
    return;
  }

  // 4. Проверка что ставка еще не сделана
  if (hasBet) {
    showError('You already have a bet on this game');
    return;
  }

  // 5. Проверка суммы ставки
  if (!amount || amount <= 0) {
    showError('Bet amount must be greater than 0');
    return;
  }

  // 6. Проверка минимальной ставки
  const MIN_BET = 25;
  if (amount < MIN_BET) {
    showError(`Minimum bet is ${MIN_BET}`);
    return;
  }

  // 7. Проверка максимальной ставки
  const MAX_BET = 10000;
  if (amount > MAX_BET) {
    showError(`Maximum bet is ${MAX_BET}`);
    return;
  }

  // 8. КРИТИЧНО: Проверка баланса
  if (userBalance < amount) {
    showError(
      `Insufficient balance. You have ${userBalance}, but need ${amount}`,
    );
    return;
  }

  // 9. Проверка что до старта игры осталось время
  if (secondsLeft <= 0) {
    showError('Game is about to start, too late to bet');
    return;
  }

  // Все проверки прошли - отправляем ставку
  console.log(`✅ Validation passed, placing bet of ${amount}`);

  socket.emit('aviator:placeBet', {
    aviatorId: currentGame.id,
    amount: amount,
  });
};
```

---

## Обработка ошибок на клиенте

### Слушаем событие ошибки

```typescript
socket.on('error', (error) => {
  console.error('❌ Server error:', error.message);

  // Показываем понятное сообщение пользователю
  switch (error.message) {
    case 'Bet amount must be greater than 0':
      showError('Please enter a valid bet amount');
      break;

    case error.message.includes('Minimum bet amount'):
      showError(error.message);
      break;

    case error.message.includes('Maximum bet amount'):
      showError(error.message);
      break;

    case 'Aviator game not found':
      showError('Game not found. Please refresh the page.');
      break;

    case 'Game is not accepting bets':
      showError('Betting is closed. Wait for the next game.');
      break;

    case 'Game has already started, cannot place bet':
      showError('Too late! The game has already started.');
      break;

    case 'User is banned':
      showError('Your account has been banned.');
      router.push('/banned');
      break;

    case error.message.includes('Insufficient balance'):
      showError(error.message);
      // Обновить баланс пользователя
      fetchUserBalance();
      break;

    case 'You already have a bet on this game':
      showError('You have already placed a bet on this game');
      // Обновить состояние
      setHasBet(true);
      break;

    default:
      showError('An error occurred. Please try again.');
  }
});
```

---

## Полный пример React компонента

```tsx
import { useState, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';

export function AviatorBetForm() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [betAmount, setBetAmount] = useState(100);
  const [userBalance, setUserBalance] = useState(0);
  const [hasBet, setHasBet] = useState(false);
  const [gameStatus, setGameStatus] = useState<
    'WAITING' | 'ACTIVE' | 'FINISHED'
  >('WAITING');
  const [secondsLeft, setSecondsLeft] = useState(5);
  const [currentGame, setCurrentGame] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const MIN_BET = 25;
  const MAX_BET = 10000;

  useEffect(() => {
    const newSocket = io('ws://your-domain/ws', {
      auth: { token: localStorage.getItem('token') },
    });

    newSocket.on('connected', (data) => {
      console.log('Connected:', data);
    });

    newSocket.on('aviator:game', (game) => {
      setCurrentGame(game);
      setGameStatus(game.status);
    });

    newSocket.on('aviator:countdown', (data) => {
      setSecondsLeft(data.secondsLeft);
    });

    newSocket.on('aviator:betPlaced', (data) => {
      setHasBet(true);
      setUserBalance(data.user.balance);
      setError(null);
      console.log('✅ Bet placed successfully');
    });

    newSocket.on('error', (err) => {
      console.error('❌ Error:', err.message);
      setError(err.message);
    });

    setSocket(newSocket);

    return () => {
      newSocket.close();
    };
  }, []);

  const validateBet = (amount: number): string | null => {
    if (!amount || amount <= 0) {
      return 'Bet amount must be greater than 0';
    }

    if (amount < MIN_BET) {
      return `Minimum bet is ${MIN_BET}`;
    }

    if (amount > MAX_BET) {
      return `Maximum bet is ${MAX_BET}`;
    }

    if (userBalance < amount) {
      return `Insufficient balance. You have ${userBalance}, need ${amount}`;
    }

    if (gameStatus !== 'WAITING') {
      return 'Betting is closed';
    }

    if (hasBet) {
      return 'You already have a bet on this game';
    }

    if (secondsLeft <= 0) {
      return 'Too late to bet';
    }

    return null;
  };

  const handlePlaceBet = () => {
    if (!socket || !currentGame) {
      setError('Not connected to server');
      return;
    }

    const validationError = validateBet(betAmount);
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    console.log(`📤 Placing bet: ${betAmount}`);

    socket.emit('aviator:placeBet', {
      aviatorId: currentGame.id,
      amount: betAmount,
    });
  };

  const canPlaceBet = validateBet(betAmount) === null;

  return (
    <div className="bet-form">
      <h2>Place Your Bet</h2>

      {/* Баланс */}
      <div className="balance">
        <span>Balance:</span>
        <span className="amount">{userBalance}</span>
      </div>

      {/* Инпут ставки */}
      <div className="bet-input">
        <input
          type="number"
          value={betAmount}
          onChange={(e) => setBetAmount(Number(e.target.value))}
          min={MIN_BET}
          max={MAX_BET}
          step={10}
          disabled={hasBet || gameStatus !== 'WAITING'}
        />
        <span className="limits">
          Min: {MIN_BET} | Max: {MAX_BET}
        </span>
      </div>

      {/* Быстрые кнопки */}
      <div className="quick-bets">
        <button onClick={() => setBetAmount(25)}>25</button>
        <button onClick={() => setBetAmount(50)}>50</button>
        <button onClick={() => setBetAmount(100)}>100</button>
        <button onClick={() => setBetAmount(500)}>500</button>
        <button onClick={() => setBetAmount(1000)}>1000</button>
      </div>

      {/* Кнопка ставки */}
      <button
        onClick={handlePlaceBet}
        disabled={!canPlaceBet}
        className={`bet-button ${canPlaceBet ? 'active' : 'disabled'}`}
      >
        {hasBet ? 'Bet Placed' : `Place Bet (${betAmount})`}
      </button>

      {/* Ошибка */}
      {error && <div className="error-message">⚠️ {error}</div>}

      {/* Предупреждения */}
      {betAmount < MIN_BET && (
        <div className="warning">⚠️ Minimum bet is {MIN_BET}</div>
      )}

      {betAmount > MAX_BET && (
        <div className="warning">⚠️ Maximum bet is {MAX_BET}</div>
      )}

      {betAmount > userBalance && (
        <div className="warning">
          ⚠️ Insufficient balance (need {betAmount - userBalance} more)
        </div>
      )}

      {/* Таймер */}
      {gameStatus === 'WAITING' && (
        <div className="timer">Betting closes in {secondsLeft}s</div>
      )}
    </div>
  );
}
```

---

## CSS для формы

```css
.bet-form {
  padding: 20px;
  background: #1a1a1a;
  border-radius: 12px;
}

.balance {
  display: flex;
  justify-content: space-between;
  margin-bottom: 20px;
  font-size: 18px;
}

.balance .amount {
  color: #4caf50;
  font-weight: bold;
}

.bet-input {
  margin-bottom: 15px;
}

.bet-input input {
  width: 100%;
  padding: 15px;
  font-size: 24px;
  text-align: center;
  border: 2px solid #333;
  border-radius: 8px;
  background: #2a2a2a;
  color: white;
}

.bet-input input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.bet-input .limits {
  display: block;
  margin-top: 5px;
  font-size: 12px;
  color: #888;
}

.quick-bets {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 10px;
  margin-bottom: 20px;
}

.quick-bets button {
  padding: 10px;
  background: #333;
  border: none;
  border-radius: 6px;
  color: white;
  cursor: pointer;
  transition: all 0.2s;
}

.quick-bets button:hover {
  background: #444;
  transform: translateY(-2px);
}

.bet-button {
  width: 100%;
  padding: 20px;
  font-size: 20px;
  font-weight: bold;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.3s;
}

.bet-button.active {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

.bet-button.active:hover {
  transform: scale(1.05);
  box-shadow: 0 5px 20px rgba(102, 126, 234, 0.4);
}

.bet-button.disabled {
  background: #333;
  color: #666;
  cursor: not-allowed;
}

.error-message {
  margin-top: 15px;
  padding: 15px;
  background: #ff4757;
  color: white;
  border-radius: 8px;
  font-weight: bold;
}

.warning {
  margin-top: 10px;
  padding: 10px;
  background: #ffa502;
  color: white;
  border-radius: 6px;
  font-size: 14px;
}

.timer {
  margin-top: 15px;
  text-align: center;
  font-size: 16px;
  color: #4caf50;
  font-weight: bold;
}
```

---

## Тестирование валидации

### Тест-кейсы

1. **Ставка с достаточным балансом** ✅
   - Баланс: 1000
   - Ставка: 100
   - Результат: Успех

2. **Ставка с недостаточным балансом** ❌
   - Баланс: 50
   - Ставка: 100
   - Результат: "Insufficient balance. You have 50, but need 100"

3. **Ставка меньше минимума** ❌
   - Ставка: 10
   - Результат: "Minimum bet amount is 25. You tried to bet 10"

4. **Ставка больше максимума** ❌
   - Ставка: 15000
   - Результат: "Maximum bet amount is 10000. You tried to bet 15000"

5. **Ставка после старта игры** ❌
   - Статус: ACTIVE
   - Результат: "Game is not accepting bets"

6. **Дубликат ставки** ❌
   - Уже есть ставка
   - Результат: "You already have a bet on this game"

7. **Забаненный пользователь** ❌
   - User.isBanned: true
   - Результат: "User is banned"

---

## Логирование

Backend логирует все попытки ставок:

```
✅ User abc123 placed bet of 100 on aviator game #456
⚠️ User def456 attempted to bet 100 with insufficient balance 50
❌ User ghi789 tried to place duplicate bet on game #456
```

---

## Заключение

Система валидации ставок работает на двух уровнях:

1. **Клиент (Frontend)**: Быстрая проверка для UX
2. **Сервер (Backend)**: Гарантированная защита

**ВАЖНО:** Никогда не доверяйте только клиентской валидации! Серверная валидация обязательна для безопасности.
