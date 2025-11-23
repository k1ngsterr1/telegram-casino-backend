# Исправление застрявшей игры Aviator

## Проблема

Игра Aviator застревает в статусе `WAITING` и не переходит в `ACTIVE`. Клиенты постоянно получают одну и ту же игру со статусом `WAITING`.

**Логи:**
```
[LOG] Client requesting aviator game
✅ Found existing game #16014 with status WAITING
[LOG] Sending aviator game #16014 to client
```

---

## Причины

### 1. Игровой цикл не запущен
Метод `updateGameState()` не вызывается каждую секунду.

### 2. `currentGameId` не установлен
Gateway не знает какую игру мониторить.

### 3. Игра создана с неправильным `startsAt`
Время старта установлено слишком далеко в будущем.

### 4. Старая игра осталась в БД после краша сервера
При перезапуске сервера старая игра осталась в статусе `WAITING`.

---

## Диагностика

### Шаг 1: Проверить что игровой цикл запустился

Ищите в логах при старте сервера:

```
✅ ПРАВИЛЬНО:
[LOG] 🎮 Starting aviator game loop...
[LOG] 🎮 Initial game #16014 created with status WAITING
[LOG] ⏰ Setting up game loop interval (checking every 1 second)
[LOG] ✅ Game loop started successfully. Monitoring game #16014
[LOG] ✅ Aviator game loop initialized successfully

❌ НЕПРАВИЛЬНО (если этих логов нет):
Игровой цикл не запустился!
```

### Шаг 2: Проверить что updateGameState() работает

Каждую секунду должны появляться логи:

```
✅ ПРАВИЛЬНО:
[DEBUG] ⏳ Game #16014 WAITING: 4s until start
[DEBUG] ⏳ Game #16014 WAITING: 3s until start
[DEBUG] ⏳ Game #16014 WAITING: 2s until start
[DEBUG] ⏳ Game #16014 WAITING: 1s until start
[LOG] 🚀 Game #16014 transitioning from WAITING to ACTIVE

❌ НЕПРАВИЛЬНО (если логов нет):
updateGameState() не вызывается!
```

### Шаг 3: Проверить игру в БД

Подключитесь к БД и выполните:

```sql
SELECT 
    id,
    status,
    multiplier,
    startsAt,
    createdAt,
    NOW() as current_time,
    TIMESTAMPDIFF(SECOND, startsAt, NOW()) as seconds_overdue
FROM Aviator
WHERE status = 'WAITING'
ORDER BY createdAt DESC
LIMIT 1;
```

**Интерпретация результатов:**

```
✅ ПРАВИЛЬНО:
seconds_overdue: -4 (игра стартует через 4 секунды)
seconds_overdue: 0   (игра сейчас стартует)

❌ НЕПРАВИЛЬНО:
seconds_overdue: 300 (игра должна была стартовать 5 минут назад!)
seconds_overdue: 3600 (игра застряла уже час!)
```

---

## Решения

### Решение 1: Перезапустить сервер

Самое простое решение - перезапустить сервер. При старте создастся новая игра.

```bash
# Если используется PM2
pm2 restart telegram-casino-backend

# Если используется npm
npm run start:dev
```

**После перезапуска проверьте логи:**
- Должен быть `🎮 Starting aviator game loop...`
- Должен быть `✅ Game loop started successfully`
- Каждую секунду должны быть `⏳ Game #XXXX WAITING`

---

### Решение 2: Завершить застрявшую игру в БД

Если перезапуск не помог, завершите старую игру вручную:

```sql
-- Показать все застрявшие игры
SELECT id, status, startsAt, createdAt
FROM Aviator
WHERE status IN ('WAITING', 'ACTIVE')
  AND createdAt < DATE_SUB(NOW(), INTERVAL 5 MINUTE);

-- Завершить их
UPDATE Aviator 
SET status = 'FINISHED', updatedAt = NOW() 
WHERE status IN ('WAITING', 'ACTIVE')
  AND createdAt < DATE_SUB(NOW(), INTERVAL 5 MINUTE);
```

**После выполнения:**
1. Сервер автоматически создаст новую игру через 3 секунды
2. Проверьте логи: `🆕 New game #XXXX created`

---

### Решение 3: Включить DEBUG логи

Включите debug логи в `main.ts` или через переменные окружения:

```typescript
// main.ts
app.useLogger(['log', 'error', 'warn', 'debug', 'verbose']);
```

Или через `.env`:
```
LOG_LEVEL=debug
```

**После этого вы увидите:**
- `[DEBUG] ⏳ Game #XXXX WAITING: Xs until start` - каждую секунду
- Детальную информацию о переходах состояний

---

### Решение 4: Проверить что WebsocketModule загружается

Убедитесь что `WebsocketModule` импортирован в `AppModule`:

```typescript
// app.module.ts
import { WebsocketModule } from './websocket/websocket.module';

@Module({
  imports: [
    // ...
    WebsocketModule,  // ← Должен быть здесь!
  ],
})
export class AppModule {}
```

---

## Предотвращение проблемы

### 1. Добавить автоматическую очистку при старте

В `onModuleInit` можно добавить очистку старых игр:

```typescript
async onModuleInit() {
  // Завершить все старые игры перед стартом
  await this.prisma.aviator.updateMany({
    where: {
      status: {
        in: ['WAITING', 'ACTIVE'],
      },
      createdAt: {
        lt: new Date(Date.now() - 5 * 60 * 1000), // Старше 5 минут
      },
    },
    data: {
      status: 'FINISHED',
    },
  });

  this.logger.log('🧹 Cleaned up old stuck games');
  
  // Затем запустить игровой цикл
  await this.startGameLoop();
}
```

### 2. Добавить health check

Создайте endpoint для проверки состояния игры:

```typescript
@Get('/health/aviator')
async aviatorHealth() {
  const currentGame = await this.prisma.aviator.findFirst({
    where: {
      status: {
        in: ['WAITING', 'ACTIVE'],
      },
    },
  });

  if (!currentGame) {
    return { status: 'no_game', healthy: false };
  }

  const now = new Date();
  const startsAt = new Date(currentGame.startsAt);
  const timeUntilStart = startsAt.getTime() - now.getTime();

  // Проверка: если игра WAITING больше 1 минуты - проблема
  if (currentGame.status === 'WAITING' && timeUntilStart < -60000) {
    return {
      status: 'stuck',
      healthy: false,
      game: currentGame,
      secondsOverdue: Math.floor(-timeUntilStart / 1000),
    };
  }

  return {
    status: 'ok',
    healthy: true,
    gameStatus: currentGame.status,
    gameId: currentGame.id,
  };
}
```

### 3. Добавить мониторинг в gameLoop

```typescript
private async updateGameState() {
  try {
    // ... существующий код ...

    // В конце метода
    const loopIteration = (this as any).loopCounter || 0;
    (this as any).loopCounter = loopIteration + 1;

    // Каждые 10 секунд выводить статус
    if (loopIteration % 10 === 0) {
      this.logger.log(
        `💓 Game loop heartbeat: iteration ${loopIteration}, game #${this.currentGameId}, status: ${game?.status}`,
      );
    }
  } catch (error) {
    this.logger.error('Error in updateGameState', error);
  }
}
```

---

## Чек-лист проверки

После применения решения проверьте:

- [ ] Логи: `🎮 Starting aviator game loop...`
- [ ] Логи: `✅ Game loop started successfully`
- [ ] Логи: `⏳ Game #XXXX WAITING: Xs until start` (каждую секунду)
- [ ] Логи: `🚀 Game #XXXX transitioning from WAITING to ACTIVE` (через 5 сек)
- [ ] Логи: `💥 Game #XXXX transitioning from ACTIVE to FINISHED` (через ~2 сек)
- [ ] Логи: `🆕 New game #XXXX created` (через 3 сек после краша)
- [ ] Клиент получает разные game ID при последовательных запросах
- [ ] Клиент получает события `aviator:statusChange`
- [ ] Клиент получает события `aviator:countdown`

---

## Частые вопросы

### Q: Почему игра застряла в WAITING?

**A:** Три основные причины:
1. Игровой цикл (`updateGameState`) не запущен
2. `startsAt` установлен в далеком будущем
3. Старая игра осталась после краша сервера

### Q: Как проверить что игровой цикл работает?

**A:** Ищите в логах строки с `⏳ Game #XXXX WAITING`. Они должны появляться каждую секунду.

### Q: Можно ли вручную запустить переход WAITING → ACTIVE?

**A:** Да, через SQL:

```sql
UPDATE Aviator 
SET status = 'ACTIVE', startsAt = NOW() 
WHERE id = 16014;
```

Но лучше дать серверу сделать это автоматически.

### Q: Что делать если после перезапуска проблема повторяется?

**A:**
1. Проверьте что `WebsocketModule` загружается
2. Проверьте что нет ошибок в `onModuleInit`
3. Добавьте больше логирования
4. Проверьте что БД доступна

---

## Логи здорового состояния

**При старте сервера:**
```
[LOG] 🎮 Starting aviator game loop...
[LOG] 📊 Loaded 20 crashes from database: [2.45, 1.00, 5.67, ...]
[LOG] 🎮 Initial game #16015 created with status WAITING
[LOG] ⏰ Setting up game loop interval (checking every 1 second)
[LOG] ✅ Game loop started successfully. Monitoring game #16015
[LOG] ✅ Aviator game loop initialized successfully
```

**Во время работы (каждую секунду):**
```
[DEBUG] ⏳ Game #16015 WAITING: 4s until start
[DEBUG] ⏳ Game #16015 WAITING: 3s until start
[DEBUG] ⏳ Game #16015 WAITING: 2s until start
[DEBUG] ⏳ Game #16015 WAITING: 1s until start
[LOG] 🚀 Game #16015 transitioning from WAITING to ACTIVE
[DEBUG] 💓 Game loop heartbeat: iteration 10, game #16015, status: ACTIVE
[LOG] 💥 Game #16015 transitioning from ACTIVE to FINISHED (crashed at 2.45x)
[LOG] 🆕 New game #16016 created with status WAITING
```

---

## Скрипты для диагностики

Используйте готовые скрипты:

```bash
# Диагностика
bash scripts/diagnose-aviator.sh

# SQL запросы
# Откройте scripts/fix-stuck-aviator-games.sql
```

---

## Заключение

Проблема застрявшей игры решается:
1. Перезапуском сервера (90% случаев)
2. Очисткой старых игр в БД (9% случаев)
3. Проверкой загрузки модуля (1% случаев)

После исправления проблема не должна повторяться, так как:
- Игровой цикл работает автоматически
- Старые игры очищаются при старте
- Добавлено детальное логирование для диагностики
