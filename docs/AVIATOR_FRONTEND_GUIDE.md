# 🎮 Aviator Frontend Implementation Guide

**Полное руководство по реализации фронтенда для игры Aviator**

---

## 📋 Содержание

1. [Обзор игры](#обзор-игры)
2. [WebSocket подключение](#websocket-подключение)
3. [Жизненный цикл игры](#жизненный-цикл-игры)
4. [События от сервера](#события-от-сервера)
5. [Отправка команд на сервер](#отправка-команд-на-сервер)
6. [Визуализация множителя](#визуализация-множителя)
7. [Работа со ставками](#работа-со-ставками)
8. [История крашей](#история-крашей)
9. [Типы данных](#типы-данных)
10. [Примеры кода](#примеры-кода)
11. [Частые ошибки](#частые-ошибки)

---

## 🎯 Обзор игры

### Что такое Aviator?

**Aviator** — это multiplayer игра, где:

- Самолет "взлетает" и множитель растет от **1.00x** до момента краша
- Игроки делают ставки **ДО старта** игры (в статусе `WAITING`)
- Игроки могут **кешаутить** (забрать выигрыш) в любой момент до краша
- Если не успел кешаутить до краша — **проиграл**
- Игра провайдбл-фэйр (можно проверить честность через `serverSeed`, `clientSeed`, `nonce`)

### Основные фазы игры

```
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│   WAITING   │  →   │   ACTIVE    │  →   │  FINISHED   │
│   (10 сек)  │      │  (8-28 сек) │      │   (3 сек)   │
└─────────────┘      └─────────────┘      └─────────────┘
     ↓                      ↓                     ↓
  Принимаем            Множитель           Новая игра
    ставки               растет             создается
```

---

## 🔌 WebSocket подключение

### 1. Подключение к серверу

```typescript
import { io, Socket } from 'socket.io-client';

const socket: Socket = io('https://your-backend.com/ws', {
  auth: {
    token: 'YOUR_JWT_TOKEN', // Обязательно!
  },
  transports: ['websocket'],
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionAttempts: 5,
});
```

### 2. Обработка подключения

```typescript
socket.on('connect', () => {
  console.log('✅ Connected to server');
  console.log('Socket ID:', socket.id);

  // Сразу запрашиваем текущую игру
  socket.emit('aviator:getCurrent');

  // Запрашиваем серверное время для синхронизации
  socket.emit('getServerTime');
});

socket.on('connected', (data) => {
  console.log('Welcome message:', data.message);
  console.log('Active users:', data.activeUsers);
});

socket.on('disconnect', (reason) => {
  console.log('❌ Disconnected:', reason);
});

socket.on('error', (error) => {
  console.error('Socket error:', error);
});
```

### 3. Получение серверного времени (важно!)

```typescript
socket.on('serverTime', (data) => {
  /*
  data = {
    serverTime: 1700000000000,      // timestamp в миллисекундах
    serverTimestamp: "2024-11-26...", // ISO string
    multiplierFormula: 5000,         // КРИТИЧЕСКИ ВАЖНО: 5000ms = 1.0x
    tickRate: 50                     // Сервер шлет тики каждые 50ms
  }
  */

  const clientTime = Date.now();
  const serverTime = data.serverTime;
  const timeDrift = clientTime - serverTime;

  // Сохраняем дрифт для корректировки
  window.TIME_DRIFT = timeDrift;

  console.log('⏰ Time drift:', timeDrift, 'ms');
});
```

---

## 🔄 Жизненный цикл игры

### Состояния игры

```typescript
enum AviatorStatus {
  WAITING = 'WAITING', // Ожидание старта, принимаются ставки
  ACTIVE = 'ACTIVE', // Игра идет, множитель растет
  FINISHED = 'FINISHED', // Игра закончилась (crashed)
}

interface AviatorGame {
  id: number;
  status: AviatorStatus;
  multiplier: number; // Финальный множитель краша
  clientSeed: string; // Для проверки честности
  nonce: number; // Для проверки честности
  startsAt: string; // ISO timestamp когда игра стартует/стартовала
  createdAt: string;
  updatedAt: string;
  bets: AviatorBet[];
}
```

### Фаза 1: WAITING (10 секунд)

**Что происходит:**

- Игра только что создана
- Принимаются ставки от игроков
- Отображается таймер до старта
- **НЕЛЬЗЯ** кешаутить

**Что делать на фронте:**

```typescript
function handleWaitingState(game: AviatorGame) {
  // 1. Показываем статус "Ожидание старта"
  setGameStatus('WAITING');

  // 2. Включаем форму для ставок
  setCanPlaceBet(true);
  setCanCashout(false);

  // 3. Запускаем обратный отсчет до старта
  const startTime = new Date(game.startsAt).getTime();
  const now = Date.now() - window.TIME_DRIFT; // Корректируем время
  const timeUntilStart = startTime - now;

  if (timeUntilStart > 0) {
    startCountdown(timeUntilStart);
  }

  // 4. Показываем текущие ставки других игроков
  renderBets(game.bets);

  // 5. Обнуляем множитель
  setCurrentMultiplier(1.0);
}

function startCountdown(milliseconds: number) {
  let remaining = milliseconds;

  const interval = setInterval(() => {
    remaining -= 100;

    const seconds = Math.max(0, Math.ceil(remaining / 1000));
    updateCountdownDisplay(seconds); // "Старт через: 5"

    if (remaining <= 0) {
      clearInterval(interval);
      // Игра должна начаться!
    }
  }, 100);
}
```

### Фаза 2: ACTIVE (переменная длительность)

**Что происходит:**

- Игра началась
- Множитель растет от 1.00x
- Игроки могут кешаутить
- **НЕЛЬЗЯ** делать новые ставки

**Формула множителя (КРИТИЧЕСКИ ВАЖНО!):**

```typescript
// СИНХРОНИЗИРОВАНО С БЭКЕНДОМ!
// Бэкенд использует ту же формулу

function calculateCurrentMultiplier(
  gameStartTime: number, // timestamp в миллисекундах
  crashMultiplier: number, // финальный множитель краша
): number {
  const now = Date.now() - window.TIME_DRIFT; // Корректируем на дрифт
  const elapsed = now - gameStartTime; // Сколько прошло с старта

  // ВАЖНО: 5000ms = 1.0x прироста
  // Например: если crashMultiplier = 2.00x, то crash через 5000ms
  //           если crashMultiplier = 10.00x, то crash через 45000ms
  const crashTimeMs = (crashMultiplier - 1.0) * 5000;

  // Проверяем, не прошло ли время краша
  if (elapsed >= crashTimeMs) {
    return crashMultiplier; // Игра уже crashed
  }

  // Линейная интерполяция: прогресс от 0 до 1
  const progress = elapsed / crashTimeMs;

  // Множитель растет от 1.0 до crashMultiplier
  const currentMultiplier = 1.0 + (crashMultiplier - 1.0) * progress;

  return Number(currentMultiplier.toFixed(2));
}
```

**Что делать на фронте:**

```typescript
let animationFrameId: number | null = null;
let gameStartTime: number | null = null;
let crashMultiplier: number | null = null;

function handleActiveState(game: AviatorGame) {
  // 1. Обновляем статус
  setGameStatus('ACTIVE');

  // 2. Отключаем форму ставок, включаем кешаут
  setCanPlaceBet(false);
  setCanCashout(true); // только если есть активная ставка

  // 3. Сохраняем параметры игры
  gameStartTime = new Date(game.startsAt).getTime();
  crashMultiplier = game.multiplier;

  // 4. ЗАПУСКАЕМ АНИМАЦИЮ МНОЖИТЕЛЯ
  startMultiplierAnimation();

  // 5. Показываем ставки (кто уже кешаутил)
  renderBets(game.bets);
}

function startMultiplierAnimation() {
  const animate = () => {
    if (!gameStartTime || !crashMultiplier) return;

    const currentMultiplier = calculateCurrentMultiplier(
      gameStartTime,
      crashMultiplier,
    );

    // Обновляем UI
    updateMultiplierDisplay(currentMultiplier);

    // Обновляем потенциальный выигрыш
    if (userBet) {
      const potentialWin = userBet.amount * currentMultiplier;
      updatePotentialWinDisplay(potentialWin);
    }

    // Проверяем, не crashed ли игра
    const now = Date.now() - window.TIME_DRIFT;
    const elapsed = now - gameStartTime;
    const crashTimeMs = (crashMultiplier - 1.0) * 5000;

    if (elapsed < crashTimeMs) {
      // Игра еще идет, продолжаем анимацию
      animationFrameId = requestAnimationFrame(animate);
    } else {
      // Игра должна была crashed (но мы ждем события от сервера)
      console.log('⏰ Game should have crashed by now');
    }
  };

  animationFrameId = requestAnimationFrame(animate);
}

function stopMultiplierAnimation() {
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
}
```

### Фаза 3: FINISHED (3 секунды)

**Что происходит:**

- Игра crashed
- Показывается финальный множитель
- Обрабатываются результаты (win/lose)
- Через 3 секунды создается новая игра

**Что делать на фронте:**

```typescript
function handleFinishedState(game: AviatorGame) {
  // 1. ОСТАНАВЛИВАЕМ АНИМАЦИЮ
  stopMultiplierAnimation();

  // 2. Обновляем статус
  setGameStatus('FINISHED');

  // 3. Показываем финальный множитель (CRASHED!)
  const finalMultiplier = game.multiplier;
  showCrashAnimation(finalMultiplier);

  // 4. Отключаем все кнопки
  setCanPlaceBet(false);
  setCanCashout(false);

  // 5. Обнуляем состояние ставки пользователя
  // (win/lose события придут отдельно)

  // 6. Через 3 секунды ожидаем новую игру
  setTimeout(() => {
    console.log('⏰ Waiting for new game...');
    // Новая игра придет автоматически через событие aviator:game
  }, 3000);
}

function showCrashAnimation(multiplier: number) {
  // Визуальные эффекты:
  // - Красная вспышка
  // - Текст "CRASHED!"
  // - Показать множитель большими буквами
  // - Эффект взрыва/огня

  displayCrashedText(`${multiplier.toFixed(2)}x`);
  playCrashSound();
  triggerCrashEffect();
}
```

---

## 📡 События от сервера

### 1. `aviator:game` - Полное состояние игры

**Когда приходит:**

- При подключении к серверу
- При создании новой игры
- В ответ на `aviator:getCurrent`

```typescript
socket.on('aviator:game', (game: AviatorGame) => {
  console.log('📦 Received game state:', game);

  // Сохраняем игру в стейт
  setCurrentGame(game);

  // Обрабатываем в зависимости от статуса
  switch (game.status) {
    case 'WAITING':
      handleWaitingState(game);
      break;
    case 'ACTIVE':
      handleActiveState(game);
      break;
    case 'FINISHED':
      handleFinishedState(game);
      break;
  }
});
```

### 2. `aviator:statusChange` - Изменение статуса

**Когда приходит:**

- WAITING → ACTIVE (игра стартовала)
- ACTIVE → FINISHED (игра crashed)

```typescript
socket.on('aviator:statusChange', (data) => {
  /*
  data = {
    gameId: 123,
    status: 'ACTIVE' | 'FINISHED',
    timestamp: "2024-11-26..."
  }
  */

  console.log(`🔄 Game #${data.gameId} status changed to ${data.status}`);

  // Обновляем UI в зависимости от нового статуса
  if (data.status === 'ACTIVE') {
    // Игра началась!
    handleGameStarted();
  } else if (data.status === 'FINISHED') {
    // Игра закончилась!
    handleGameFinished();
  }
});
```

### 3. `aviator:multiplierTick` - Обновление множителя (каждые 50ms)

**ВАЖНО:** Это дополнительная синхронизация! Вы должны считать множитель локально, но сервер шлет тики для проверки.

```typescript
socket.on('aviator:multiplierTick', (data) => {
  /*
  data = {
    gameId: 123,
    currentMultiplier: 2.34,
    elapsed: 6700,           // Прошло миллисекунд с старта
    timestamp: 1700000000000
  }
  */

  // ОПЦИОНАЛЬНО: Можно проверить расхождение с локальным расчетом
  const localMultiplier = calculateCurrentMultiplier(
    gameStartTime!,
    crashMultiplier!,
  );
  const serverMultiplier = data.currentMultiplier;
  const diff = Math.abs(localMultiplier - serverMultiplier);

  if (diff > 0.05) {
    console.warn('⚠️ Multiplier drift detected:', {
      local: localMultiplier,
      server: serverMultiplier,
      diff,
    });

    // Можно использовать серверное значение для коррекции
    updateMultiplierDisplay(serverMultiplier);
  }
});
```

### 4. `aviator:crashed` - Игра crashed

```typescript
socket.on('aviator:crashed', (data) => {
  /*
  data = {
    gameId: 123,
    multiplier: 2.45,
    timestamp: "2024-11-26..."
  }
  */

  console.log(`💥 Game crashed at ${data.multiplier}x`);

  // ОСТАНАВЛИВАЕМ все анимации
  stopMultiplierAnimation();

  // Показываем краш
  showCrashAnimation(data.multiplier);

  // Ждем событий win/lose для пользователя
});
```

### 5. `aviator:newBet` - Новая ставка от игрока

```typescript
socket.on('aviator:newBet', (data) => {
  /*
  data = {
    betId: 456,
    aviatorId: 123,
    userId: "user-uuid",
    username: "John",
    amount: 100,
    timestamp: "2024-11-26..."
  }
  */

  console.log(`💰 ${data.username} placed bet: ${data.amount}`);

  // Добавляем ставку в список
  addBetToList(data);

  // Можно показать уведомление
  if (data.userId !== currentUserId) {
    showNotification(`${data.username} поставил ${data.amount}`);
  }
});
```

### 6. `aviator:cashOut` - Кто-то кешаутил

```typescript
socket.on('aviator:cashOut', (data) => {
  /*
  data = {
    betId: 456,
    aviatorId: 123,
    userId: "user-uuid",
    username: "John",
    amount: 100,            // Начальная ставка
    multiplier: 2.34,       // На каком множителе кешаутил
    winAmount: 234,         // Выигрыш
    timestamp: "2024-11-26..."
  }
  */

  console.log(
    `✅ ${data.username} cashed out at ${data.multiplier}x for ${data.winAmount}`,
  );

  // Обновляем ставку в списке (добавляем зеленую галочку)
  updateBetInList(data.betId, {
    cashedAt: data.multiplier,
    winAmount: data.winAmount,
  });

  // Показываем эффект
  showCashoutEffect(data);

  // Если это наша ставка
  if (data.userId === currentUserId) {
    setUserBet(null);
    showSuccessMessage(`Вы выиграли ${data.winAmount}!`);
    playWinSound();
  }
});
```

### 7. `aviator:win` - Вы выиграли (персональное событие)

```typescript
socket.on('aviator:win', (data) => {
  /*
  data = {
    betId: 456,
    gameId: 123,
    initialBet: 100,
    multiplier: 2.34,
    winAmount: 234,
    balance: 1234,          // Новый баланс
    isInventoryBet: false,
    timestamp: "2024-11-26..."
  }
  */

  console.log('🎉 YOU WON!', data);

  // Обновляем баланс пользователя
  setUserBalance(data.balance);

  // Показываем модалку/уведомление
  showWinModal({
    amount: data.winAmount,
    multiplier: data.multiplier,
  });

  // Эффекты
  playWinSound();
  triggerConfetti();
});
```

### 8. `aviator:lose` - Вы проиграли (персональное событие)

```typescript
socket.on('aviator:lose', (data) => {
  /*
  data = {
    betId: 456,
    gameId: 123,
    betAmount: 100,
    crashedAt: 2.45,
    isInventoryBet: false,
    timestamp: "2024-11-26..."
  }
  */

  console.log('😢 YOU LOST!', data);

  // Показываем уведомление
  showLoseNotification({
    amount: data.betAmount,
    crashedAt: data.crashedAt,
  });

  // Эффекты
  playLoseSound();
});
```

### 9. `aviator:crashHistory` - История крашей

**Когда приходит:**

- При подключении к серверу
- После каждого краша (обновленная история)

```typescript
socket.on('aviator:crashHistory', (data) => {
  /*
  data = {
    history: [2.45, 1.23, 5.67, ...], // Последние 20 крашей
    timestamp: "2024-11-26..."
  }
  */

  console.log('📊 Crash history:', data.history);

  // Отображаем историю (например, цветные плитки)
  renderCrashHistory(data.history);
});

function renderCrashHistory(history: number[]) {
  // Пример: цвета в зависимости от множителя
  return history.map((multiplier) => {
    let color = 'gray';
    if (multiplier >= 2.0) color = 'blue';
    if (multiplier >= 5.0) color = 'purple';
    if (multiplier >= 10.0) color = 'gold';

    return { multiplier, color };
  });
}
```

### 10. `activeUsersCount` - Количество онлайн игроков

```typescript
socket.on('activeUsersCount', (data) => {
  /*
  data = {
    count: 42,
    timestamp: "2024-11-26..."
  }
  */

  console.log('👥 Online players:', data.count);

  // Обновляем счетчик в UI
  setOnlinePlayersCount(data.count);
});
```

### 11. `error` - Ошибка

```typescript
socket.on('error', (data) => {
  /*
  data = {
    message: "Insufficient balance"
  }
  */

  console.error('❌ Server error:', data.message);

  // Показываем ошибку пользователю
  showErrorToast(data.message);
});
```

---

## 📤 Отправка команд на сервер

### 1. Получить текущую игру

```typescript
socket.emit('aviator:getCurrent');

// Ответ придет через событие aviator:game
```

### 2. Сделать ставку

```typescript
interface PlaceBetPayload {
  aviatorId: number;
  amount: number;
}

function placeBet(aviatorId: number, amount: number) {
  // Валидация
  if (amount < 25) {
    showError('Минимальная ставка: 25');
    return;
  }

  if (amount > 10000) {
    showError('Максимальная ставка: 10000');
    return;
  }

  if (amount > userBalance) {
    showError('Недостаточно средств');
    return;
  }

  // Отправляем
  socket.emit('aviator:placeBet', {
    aviatorId,
    amount,
  });

  // Ответ придет через aviator:betPlaced или error
}

// Обработка ответа
socket.on('aviator:betPlaced', (data) => {
  /*
  data = {
    id: 456,
    aviatorId: 123,
    userId: "user-uuid",
    amount: 100,
    cashedAt: null,
    isInventoryBet: false,
    createdAt: "2024-11-26...",
    updatedAt: "2024-11-26...",
    user: {
      id: "user-uuid",
      username: "John",
      balance: 900  // Новый баланс
    }
  }
  */

  console.log('✅ Bet placed successfully:', data);

  // Сохраняем ставку пользователя
  setUserBet(data);

  // Обновляем баланс
  setUserBalance(data.user.balance);

  // Показываем уведомление
  showSuccessToast(`Ставка ${data.amount} принята!`);
});
```

### 3. Кешаутить

```typescript
interface CashOutPayload {
  betId: number;
  currentMultiplier: number;
}

function cashOut(betId: number) {
  // Получаем текущий множитель
  const currentMultiplier = calculateCurrentMultiplier(
    gameStartTime!,
    crashMultiplier!,
  );

  console.log(`💰 Cashing out at ${currentMultiplier}x`);

  // Отправляем
  socket.emit('aviator:cashOut', {
    betId,
    currentMultiplier,
  });

  // Ответ придет через aviator:cashedOut или error
}

// Обработка ответа
socket.on('aviator:cashedOut', (data) => {
  /*
  data = {
    bet: { ... },
    winAmount: 234,
    multiplier: 2.34
  }
  */

  console.log('✅ Cashed out successfully:', data);

  // Обновляем UI
  setUserBet(null);
  showSuccessMessage(`Выигрыш: ${data.winAmount} (${data.multiplier}x)`);
});
```

### 4. Депозит из инвентаря (ставка предметом)

```typescript
interface DepositInventoryPayload {
  inventoryItemId: number;
  aviatorId: number;
}

function depositInventoryItem(inventoryItemId: number, aviatorId: number) {
  socket.emit('aviator:depositInventory', {
    inventoryItemId,
    aviatorId,
  });
}

// Ответ
socket.on('aviator:inventoryDeposited', (data) => {
  /*
  data = {
    betId: 456,
    aviatorId: 123,
    initialAmount: 500,
    depositedItem: {
      id: 789,
      name: "iPhone 15",
      amount: 500,
      url: "https://..."
    },
    createdAt: "2024-11-26..."
  }
  */

  console.log('✅ Inventory item deposited:', data);

  // Сохраняем ставку
  setUserBet({
    id: data.betId,
    amount: data.initialAmount,
    isInventoryBet: true,
    depositedItem: data.depositedItem,
  });

  // Удаляем предмет из инвентаря UI
  removeItemFromInventory(inventoryItemId);
});
```

### 5. Получить возможный приз (для инвентарных ставок)

```typescript
interface GetPossiblePrizePayload {
  currentAmount: number;
}

function getPossiblePrize(currentAmount: number) {
  socket.emit('aviator:getPossiblePrize', {
    currentAmount,
  });
}

// Ответ
socket.on('aviator:possiblePrize', (prize) => {
  /*
  prize = {
    id: 123,
    name: "iPhone 15 Pro",
    amount: 1200,
    url: "https://..."
  }
  */

  // Показываем какой приз можно получить
  displayPossiblePrize(prize);
});
```

### 6. Кешаутить подарок (для инвентарных ставок)

```typescript
interface CashOutGiftPayload {
  betId: number;
  currentMultiplier: number;
}

function cashOutGift(betId: number) {
  const currentMultiplier = calculateCurrentMultiplier(
    gameStartTime!,
    crashMultiplier!,
  );

  socket.emit('aviator:cashOutGift', {
    betId,
    currentMultiplier,
  });
}

// Ответ
socket.on('aviator:giftCashed', (data) => {
  /*
  data = {
    betId: 456,
    cashedAt: 2.34,
    initialAmount: 500,
    finalAmount: 1170,
    prize: {
      id: 123,
      name: "iPhone 15 Pro",
      amount: 1200,
      url: "https://..."
    },
    newInventoryItemId: 999
  }
  */

  console.log('🎁 Gift cashed out:', data);

  // Показываем выигранный приз
  showPrizeWinModal(data.prize);

  // Добавляем приз в инвентарь
  addItemToInventory(data.prize);
});
```

### 7. Получить историю игр

```typescript
socket.emit('aviator:getHistory', {
  limit: 20, // Опционально (default: 20, max: 100)
});

// Ответ
socket.on('aviator:history', (data) => {
  /*
  data = {
    games: [
      {
        id: 123,
        multiplier: 2.45,
        clientSeed: "abc123...",
        nonce: 456,
        status: "FINISHED",
        startsAt: "2024-11-26...",
        createdAt: "2024-11-26...",
        updatedAt: "2024-11-26...",
        totalBets: 15
      },
      ...
    ],
    count: 20,
    timestamp: "2024-11-26..."
  }
  */

  renderGameHistory(data.games);
});
```

### 8. Получить текущие ставки

```typescript
socket.emit('aviator:getCurrentBets');

// Ответ
socket.on('aviator:currentBets', (data) => {
  /*
  data = {
    bets: [
      {
        id: 456,
        userId: "user-uuid",
        username: "John",
        amount: 100,
        cashedAt: null, // или число, если уже кешаутил
        createdAt: "2024-11-26..."
      },
      ...
    ],
    count: 5,
    gameId: 123,
    timestamp: "2024-11-26..."
  }
  */

  renderCurrentBets(data.bets);
});
```

---

## 📊 Визуализация множителя

### Анимация самолета

```typescript
function animatePlane(multiplier: number) {
  // Позиция Y (высота) зависит от множителя
  // 1.00x = внизу, 10.00x = высоко

  const minY = 80; // процент от высоты контейнера
  const maxY = 10;

  // Логарифмическая шкала для лучшего визуала
  const normalizedMultiplier = Math.log(multiplier) / Math.log(100);
  const yPosition = minY - (minY - maxY) * normalizedMultiplier;

  // Позиция X (двигается вправо)
  const progress = (multiplier - 1.0) / (crashMultiplier - 1.0);
  const xPosition = 10 + progress * 80; // от 10% до 90%

  // Обновляем CSS
  planeElement.style.transform = `translate(${xPosition}%, ${yPosition}%)`;

  // Угол наклона (чем выше, тем больше угол)
  const angle = Math.min(45, normalizedMultiplier * 30);
  planeElement.style.rotate = `${angle}deg`;
}
```

### График множителя

```typescript
function drawMultiplierGraph(multiplier: number, crashMultiplier: number) {
  const canvas = graphCanvas;
  const ctx = canvas.getContext('2d');

  // Очистка
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Рисуем сетку
  drawGrid(ctx);

  // Рисуем линию графика
  ctx.beginPath();
  ctx.strokeStyle = multiplier >= crashMultiplier ? '#FF0000' : '#00FF00';
  ctx.lineWidth = 3;

  // Начало
  ctx.moveTo(0, canvas.height);

  // Текущая точка
  const progress = (multiplier - 1.0) / (crashMultiplier - 1.0);
  const x = progress * canvas.width;
  const y = canvas.height - (multiplier / crashMultiplier) * canvas.height;

  ctx.lineTo(x, y);
  ctx.stroke();

  // Точка "самолета"
  ctx.beginPath();
  ctx.arc(x, y, 5, 0, Math.PI * 2);
  ctx.fillStyle = '#FFD700';
  ctx.fill();
}
```

### Отображение множителя

```typescript
function updateMultiplierDisplay(multiplier: number) {
  const element = document.getElementById('multiplier');

  // Форматирование: 1.23x
  element.textContent = `${multiplier.toFixed(2)}x`;

  // Цвет в зависимости от значения
  if (multiplier < 2.0) {
    element.style.color = '#FFFFFF';
  } else if (multiplier < 5.0) {
    element.style.color = '#00FF00';
  } else if (multiplier < 10.0) {
    element.style.color = '#FFD700';
  } else {
    element.style.color = '#FF1493';
  }

  // Размер шрифта растет
  const baseFontSize = 48;
  const scale = 1 + Math.log(multiplier) * 0.1;
  element.style.fontSize = `${baseFontSize * scale}px`;
}
```

---

## 💰 Работа со ставками

### Список текущих ставок

```typescript
interface BetListItem {
  id: number;
  username: string;
  amount: number;
  cashedAt: number | null;
  winAmount?: number;
  isInventoryBet?: boolean;
}

function renderBetsList(bets: BetListItem[]) {
  return (
    <div className="bets-list">
      {bets.map(bet => (
        <div key={bet.id} className={`bet-item ${bet.cashedAt ? 'cashed' : ''}`}>
          <span className="username">{bet.username}</span>
          <span className="amount">{bet.amount}</span>

          {bet.cashedAt && (
            <>
              <span className="multiplier">{bet.cashedAt}x</span>
              <span className="win-amount">+{bet.winAmount}</span>
            </>
          )}

          {bet.isInventoryBet && (
            <span className="badge">🎁 Gift</span>
          )}
        </div>
      ))}
    </div>
  );
}
```

### Форма ставки

```typescript
function BetForm() {
  const [amount, setAmount] = useState(100);
  const [canBet, setCanBet] = useState(false);

  const handlePlaceBet = () => {
    if (!currentGame || currentGame.status !== 'WAITING') {
      showError('Ставки сейчас не принимаются');
      return;
    }

    placeBet(currentGame.id, amount);
  };

  return (
    <div className="bet-form">
      <input
        type="number"
        value={amount}
        onChange={(e) => setAmount(Number(e.target.value))}
        min={25}
        max={10000}
        disabled={!canBet}
      />

      <button
        onClick={handlePlaceBet}
        disabled={!canBet || userBet !== null}
      >
        {userBet ? 'Ставка сделана' : 'Поставить'}
      </button>

      {/* Быстрые ставки */}
      <div className="quick-bets">
        {[50, 100, 500, 1000].map(value => (
          <button key={value} onClick={() => setAmount(value)}>
            {value}
          </button>
        ))}
      </div>
    </div>
  );
}
```

### Кнопка кешаута

```typescript
function CashoutButton() {
  const [canCashout, setCanCashout] = useState(false);
  const [potentialWin, setPotentialWin] = useState(0);

  const handleCashout = () => {
    if (!userBet) return;

    // Показываем подтверждение (опционально)
    if (confirm(`Забрать ${potentialWin}?`)) {
      cashOut(userBet.id);
    }
  };

  return (
    <button
      className="cashout-button"
      onClick={handleCashout}
      disabled={!canCashout || !userBet}
    >
      <span className="label">Забрать</span>
      <span className="amount">{potentialWin}</span>
    </button>
  );
}
```

---

## 📜 История крашей

### Визуализация

```typescript
function CrashHistoryDisplay({ history }: { history: number[] }) {
  return (
    <div className="crash-history">
      <h3>История</h3>
      <div className="history-items">
        {history.map((multiplier, index) => {
          const color = getColorByMultiplier(multiplier);

          return (
            <div
              key={index}
              className="history-item"
              style={{ backgroundColor: color }}
            >
              {multiplier.toFixed(2)}x
            </div>
          );
        })}
      </div>
    </div>
  );
}

function getColorByMultiplier(multiplier: number): string {
  if (multiplier < 2.0) return '#6B7280';   // Серый
  if (multiplier < 5.0) return '#3B82F6';   // Синий
  if (multiplier < 10.0) return '#8B5CF6';  // Фиолетовый
  if (multiplier < 50.0) return '#F59E0B';  // Оранжевый
  return '#EF4444';                         // Красный (очень редко)
}
```

---

## 📦 Типы данных (TypeScript)

```typescript
// ===== GAME =====

enum AviatorStatus {
  WAITING = 'WAITING',
  ACTIVE = 'ACTIVE',
  FINISHED = 'FINISHED',
}

interface AviatorGame {
  id: number;
  status: AviatorStatus;
  multiplier: number;
  clientSeed: string;
  nonce: number;
  startsAt: string; // ISO timestamp
  createdAt: string;
  updatedAt: string;
  bets: AviatorBet[];
}

// ===== BET =====

interface AviatorBet {
  id: number;
  aviatorId: number;
  userId: string;
  amount: number;
  cashedAt: number | null;
  isInventoryBet: boolean;
  prizeId: number | null;
  createdAt: string;
  updatedAt: string;
  user: {
    id: string;
    username: string;
    telegramId: string;
  };
}

// ===== EVENTS =====

interface StatusChangeEvent {
  gameId: number;
  status: AviatorStatus;
  timestamp: string;
}

interface MultiplierTickEvent {
  gameId: number;
  currentMultiplier: number;
  elapsed: number;
  timestamp: number;
}

interface CrashedEvent {
  gameId: number;
  multiplier: number;
  timestamp: string;
}

interface NewBetEvent {
  betId: number;
  aviatorId: number;
  userId: string;
  username: string;
  amount: number;
  timestamp: string;
}

interface CashOutEvent {
  betId: number;
  aviatorId: number;
  userId: string;
  username: string;
  amount: number;
  multiplier: number;
  winAmount: number;
  timestamp: string;
}

interface WinEvent {
  betId: number;
  gameId: number;
  initialBet: number;
  multiplier: number;
  winAmount: number;
  balance: number;
  isInventoryBet: boolean;
  timestamp: string;
}

interface LoseEvent {
  betId: number;
  gameId: number;
  betAmount: number;
  crashedAt: number;
  isInventoryBet: boolean;
  timestamp: string;
}

interface CrashHistoryEvent {
  history: number[];
  timestamp: string;
}

// ===== PRIZE =====

interface Prize {
  id: number;
  name: string;
  amount: number;
  url: string;
}

// ===== INVENTORY =====

interface InventoryItem {
  id: number;
  userId: string;
  prizeId: number;
  prize: Prize;
  createdAt: string;
  updatedAt: string;
}
```

---

## 🎨 Примеры кода

### React + Socket.IO

```typescript
import React, { useEffect, useState, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

export function AviatorGame() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [currentGame, setCurrentGame] = useState<AviatorGame | null>(null);
  const [currentMultiplier, setCurrentMultiplier] = useState(1.00);
  const [userBet, setUserBet] = useState<AviatorBet | null>(null);
  const [crashHistory, setCrashHistory] = useState<number[]>([]);
  const [onlineCount, setOnlineCount] = useState(0);

  const gameStartTimeRef = useRef<number | null>(null);
  const crashMultiplierRef = useRef<number | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // ===== ПОДКЛЮЧЕНИЕ =====

  useEffect(() => {
    const newSocket = io('https://your-backend.com/ws', {
      auth: {
        token: localStorage.getItem('token')
      }
    });

    setSocket(newSocket);

    // Подписываемся на события
    newSocket.on('connected', handleConnected);
    newSocket.on('aviator:game', handleGameUpdate);
    newSocket.on('aviator:statusChange', handleStatusChange);
    newSocket.on('aviator:multiplierTick', handleMultiplierTick);
    newSocket.on('aviator:crashed', handleCrashed);
    newSocket.on('aviator:newBet', handleNewBet);
    newSocket.on('aviator:cashOut', handleCashOut);
    newSocket.on('aviator:win', handleWin);
    newSocket.on('aviator:lose', handleLose);
    newSocket.on('aviator:crashHistory', handleCrashHistory);
    newSocket.on('activeUsersCount', handleActiveUsers);
    newSocket.on('error', handleError);

    // Cleanup
    return () => {
      newSocket.close();
    };
  }, []);

  // ===== ОБРАБОТЧИКИ СОБЫТИЙ =====

  const handleConnected = (data: any) => {
    console.log('✅ Connected:', data);
    socket?.emit('aviator:getCurrent');
    socket?.emit('getServerTime');
  };

  const handleGameUpdate = (game: AviatorGame) => {
    console.log('📦 Game update:', game);
    setCurrentGame(game);

    if (game.status === 'WAITING') {
      handleWaitingState(game);
    } else if (game.status === 'ACTIVE') {
      handleActiveState(game);
    } else if (game.status === 'FINISHED') {
      handleFinishedState(game);
    }
  };

  const handleWaitingState = (game: AviatorGame) => {
    stopMultiplierAnimation();
    setCurrentMultiplier(1.00);
    gameStartTimeRef.current = null;
    crashMultiplierRef.current = null;
  };

  const handleActiveState = (game: AviatorGame) => {
    gameStartTimeRef.current = new Date(game.startsAt).getTime();
    crashMultiplierRef.current = game.multiplier;
    startMultiplierAnimation();
  };

  const handleFinishedState = (game: AviatorGame) => {
    stopMultiplierAnimation();
    setCurrentMultiplier(game.multiplier);
  };

  const handleStatusChange = (data: StatusChangeEvent) => {
    console.log('🔄 Status change:', data);
  };

  const handleMultiplierTick = (data: MultiplierTickEvent) => {
    // Опционально: синхронизация с сервером
  };

  const handleCrashed = (data: CrashedEvent) => {
    console.log('💥 Crashed at', data.multiplier);
    stopMultiplierAnimation();
    setCurrentMultiplier(data.multiplier);
  };

  const handleNewBet = (data: NewBetEvent) => {
    console.log('💰 New bet:', data);
    // Обновить список ставок
  };

  const handleCashOut = (data: CashOutEvent) => {
    console.log('✅ Cash out:', data);
    // Обновить список ставок
  };

  const handleWin = (data: WinEvent) => {
    console.log('🎉 You won!', data);
    alert(`Вы выиграли ${data.winAmount}!`);
  };

  const handleLose = (data: LoseEvent) => {
    console.log('😢 You lost!', data);
    alert(`Вы проиграли ${data.betAmount}`);
  };

  const handleCrashHistory = (data: CrashHistoryEvent) => {
    setCrashHistory(data.history);
  };

  const handleActiveUsers = (data: { count: number }) => {
    setOnlineCount(data.count);
  };

  const handleError = (data: { message: string }) => {
    alert('Ошибка: ' + data.message);
  };

  // ===== АНИМАЦИЯ МНОЖИТЕЛЯ =====

  const startMultiplierAnimation = () => {
    const animate = () => {
      if (!gameStartTimeRef.current || !crashMultiplierRef.current) return;

      const multiplier = calculateCurrentMultiplier(
        gameStartTimeRef.current,
        crashMultiplierRef.current
      );

      setCurrentMultiplier(multiplier);

      const now = Date.now();
      const elapsed = now - gameStartTimeRef.current;
      const crashTimeMs = (crashMultiplierRef.current - 1.0) * 5000;

      if (elapsed < crashTimeMs) {
        animationFrameRef.current = requestAnimationFrame(animate);
      }
    };

    animate();
  };

  const stopMultiplierAnimation = () => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  };

  const calculateCurrentMultiplier = (
    gameStartTime: number,
    crashMultiplier: number
  ): number => {
    const now = Date.now();
    const elapsed = now - gameStartTime;
    const crashTimeMs = (crashMultiplier - 1.0) * 5000;

    if (elapsed >= crashTimeMs) {
      return crashMultiplier;
    }

    const progress = elapsed / crashTimeMs;
    const currentMultiplier = 1.0 + (crashMultiplier - 1.0) * progress;

    return Number(currentMultiplier.toFixed(2));
  };

  // ===== ДЕЙСТВИЯ =====

  const placeBet = (amount: number) => {
    if (!currentGame) return;

    socket?.emit('aviator:placeBet', {
      aviatorId: currentGame.id,
      amount
    });
  };

  const cashOut = () => {
    if (!userBet) return;

    socket?.emit('aviator:cashOut', {
      betId: userBet.id,
      currentMultiplier
    });
  };

  // ===== RENDER =====

  return (
    <div className="aviator-game">
      <header>
        <h1>Aviator</h1>
        <span>👥 {onlineCount} online</span>
      </header>

      <div className="game-area">
        <div className="multiplier-display">
          <span className="multiplier">{currentMultiplier.toFixed(2)}x</span>
          {currentGame?.status === 'WAITING' && (
            <span className="status">Ожидание старта...</span>
          )}
          {currentGame?.status === 'ACTIVE' && (
            <span className="status">Игра идет!</span>
          )}
          {currentGame?.status === 'FINISHED' && (
            <span className="status crashed">CRASHED!</span>
          )}
        </div>

        {/* Визуализация самолета */}
        <div className="plane">✈️</div>
      </div>

      <div className="controls">
        {currentGame?.status === 'WAITING' && !userBet && (
          <div className="bet-form">
            <input type="number" placeholder="Сумма ставки" />
            <button onClick={() => placeBet(100)}>Поставить</button>
          </div>
        )}

        {currentGame?.status === 'ACTIVE' && userBet && (
          <button className="cashout-button" onClick={cashOut}>
            Забрать ({(userBet.amount * currentMultiplier).toFixed(0)})
          </button>
        )}
      </div>

      <div className="crash-history">
        {crashHistory.map((mult, i) => (
          <div key={i} className="history-item">
            {mult.toFixed(2)}x
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

## ⚠️ Частые ошибки

### 1. Не учитывается time drift

```typescript
// ❌ НЕПРАВИЛЬНО
const elapsed = Date.now() - gameStartTime;

// ✅ ПРАВИЛЬНО
const correctedTime = Date.now() - window.TIME_DRIFT;
const elapsed = correctedTime - gameStartTime;
```

### 2. Неправильная формула множителя

```typescript
// ❌ НЕПРАВИЛЬНО
const multiplier = 1.0 + elapsed / 1000; // Линейный рост

// ✅ ПРАВИЛЬНО (синхронизировано с бэкендом)
const crashTimeMs = (crashMultiplier - 1.0) * 5000; // 5000ms = 1.0x
const progress = elapsed / crashTimeMs;
const multiplier = 1.0 + (crashMultiplier - 1.0) * progress;
```

### 3. Забыли остановить анимацию

```typescript
// ❌ НЕПРАВИЛЬНО
// Анимация продолжает работать после краша

// ✅ ПРАВИЛЬНО
socket.on('aviator:crashed', () => {
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
});
```

### 4. Не проверяется статус игры перед действием

```typescript
// ❌ НЕПРАВИЛЬНО
function placeBet() {
  socket.emit('aviator:placeBet', { ... });
}

// ✅ ПРАВИЛЬНО
function placeBet() {
  if (currentGame?.status !== 'WAITING') {
    showError('Ставки сейчас не принимаются');
    return;
  }

  socket.emit('aviator:placeBet', { ... });
}
```

### 5. Не обрабатываются ошибки

```typescript
// ❌ НЕПРАВИЛЬНО
socket.emit('aviator:placeBet', { ... });
// Ждем только успешный ответ

// ✅ ПРАВИЛЬНО
socket.emit('aviator:placeBet', { ... });

socket.on('aviator:betPlaced', (data) => {
  // Успех
});

socket.on('error', (data) => {
  // Ошибка
  showError(data.message);
});
```

---

## 🎯 Чек-лист реализации

### Обязательные фичи

- [ ] WebSocket подключение с JWT токеном
- [ ] Получение серверного времени и расчет time drift
- [ ] Обработка всех 3 статусов игры (WAITING, ACTIVE, FINISHED)
- [ ] Локальный расчет множителя по формуле `(crashMultiplier - 1.0) * 5000ms`
- [ ] Анимация самолета/графика с использованием `requestAnimationFrame`
- [ ] Форма ставки (работает только в WAITING)
- [ ] Кнопка кешаута (работает только в ACTIVE)
- [ ] Отображение списка текущих ставок
- [ ] Обработка событий win/lose
- [ ] История крашей (последние 20)
- [ ] Счетчик онлайн игроков
- [ ] Обработка ошибок

### Опциональные фичи

- [ ] Синхронизация с `aviator:multiplierTick` (каждые 50ms)
- [ ] Ставки из инвентаря (depositInventory)
- [ ] Предпросмотр возможного приза (getPossiblePrize)
- [ ] Кешаут подарка (cashOutGift)
- [ ] История игр (getHistory)
- [ ] Провайдбл фэйр верификация (serverSeed, clientSeed, nonce)
- [ ] Звуковые эффекты
- [ ] Конфетти при выигрыше
- [ ] Чат игроков
- [ ] Таблица лидеров

---

## 📚 Дополнительная информация

### Провайдбл Фэйр

Игра использует алгоритм **HMAC-SHA256** для генерации честных множителей:

```
Hash = HMAC-SHA256(serverSeed, clientSeed:nonce)
Multiplier = f(Hash)
```

Вы можете реализовать проверку честности на фронте:

```typescript
import crypto from 'crypto';

function verifyMultiplier(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  claimedMultiplier: number,
): boolean {
  const message = `${clientSeed}:${nonce}`;
  const hash = crypto
    .createHmac('sha256', serverSeed)
    .update(message)
    .digest('hex');

  // Дальше нужна сложная логика из бэкенда...
  // Для простоты можно просто показать hash пользователю

  return true;
}
```

### Настройки игры

Получить текущие настройки:

```typescript
// Минимальная/максимальная ставка
// Target RTP (Return To Player)
// Instant crash probability
// и т.д.

// Эти настройки можно запросить через REST API
fetch('/api/admin/aviator/settings')
  .then((res) => res.json())
  .then((settings) => {
    console.log('Min bet:', settings.minBet);
    console.log('Max bet:', settings.maxBet);
    console.log('Target RTP:', settings.targetRtp);
  });
```

---

## 🔧 Troubleshooting

### Проблема: Множитель не синхронизирован

**Решение:**

1. Проверьте формулу: `(crashMultiplier - 1.0) * 5000`
2. Убедитесь что используете time drift коррекцию
3. Подписывайтесь на `aviator:multiplierTick` для дополнительной синхронизации

### Проблема: Ставка не принимается

**Решение:**

1. Проверьте статус игры (должен быть WAITING)
2. Проверьте время старта игры (не должен быть в прошлом)
3. Проверьте баланс пользователя
4. Проверьте лимиты (25 ≤ amount ≤ 10000)

### Проблема: Кешаут не срабатывает

**Решение:**

1. Проверьте статус игры (должен быть ACTIVE)
2. Убедитесь что множитель не превышает crashMultiplier
3. Проверьте что ставка еще не кешаутнута (cashedAt === null)

---

## 📞 Поддержка

Если у вас возникли вопросы по реализации, проверьте:

1. **Логи сервера** - все события логируются с эмодзи
2. **События WebSocket** - используйте `socket.onAny()` для отладки
3. **Console DevTools** - проверяйте Network tab для WS соединения

---

**Удачи в разработке! 🚀**
