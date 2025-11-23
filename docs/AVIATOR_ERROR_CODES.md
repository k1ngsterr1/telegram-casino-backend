# Коды ошибок Aviator - Шпаргалка

## Ошибки при размещении ставки

| Код | Сообщение                             | Причина                | Решение                            |
| --- | ------------------------------------- | ---------------------- | ---------------------------------- |
| 400 | `Bet amount must be greater than 0`   | Сумма ≤ 0              | Введите положительную сумму        |
| 400 | `Minimum bet amount is 25`            | Сумма < 25             | Увеличьте ставку до минимум 25     |
| 400 | `Maximum bet amount is 10000`         | Сумма > 10000          | Уменьшите ставку до максимум 10000 |
| 404 | `Aviator game not found`              | Игра не существует     | Обновите страницу                  |
| 400 | `Game is not accepting bets`          | Статус не WAITING      | Дождитесь следующей игры           |
| 400 | `Game has already started`            | Время истекло          | Дождитесь следующей игры           |
| 404 | `User not found`                      | Пользователь не найден | Перелогиньтесь                     |
| 403 | `User is banned`                      | Пользователь забанен   | Обратитесь в поддержку             |
| 400 | `Insufficient balance`                | Баланс < ставка        | Пополните баланс                   |
| 400 | `You already have a bet on this game` | Дубликат ставки        | Дождитесь следующей игры           |

---

## Ошибки при кешауте

| Код | Сообщение                                 | Причина              | Решение                 |
| --- | ----------------------------------------- | -------------------- | ----------------------- |
| 400 | `Invalid multiplier`                      | Множитель < 1        | Проверьте множитель     |
| 404 | `Bet not found`                           | Ставка не существует | Проверьте ID ставки     |
| 403 | `Unauthorized to cash out this bet`       | Чужая ставка         | Используйте свою ставку |
| 403 | `User is banned`                          | Пользователь забанен | Обратитесь в поддержку  |
| 400 | `Bet has already been cashed out`         | Уже сделан кешаут    | Нельзя кешаутить дважды |
| 400 | `Game is no longer active`                | Статус не ACTIVE     | Уже поздно              |
| 400 | `Game has not started yet`                | Игра не началась     | Дождитесь старта        |
| 400 | `Cannot cash out after plane has crashed` | Множитель > краш     | Уже слишком поздно      |

---

## Быстрая проверка на клиенте

```typescript
// Проверка перед ставкой
const canPlaceBet =
  betAmount >= 25 && // Минимум
  betAmount <= 10000 && // Максимум
  userBalance >= betAmount && // Баланс
  gameStatus === 'WAITING' && // Статус
  !hasBet && // Нет дубликата
  secondsLeft > 0; // Есть время

// Проверка перед кешаутом
const canCashOut =
  myBetId !== null && // Есть ID ставки
  !cashedOut && // Еще не кешаучено
  gameStatus === 'ACTIVE' && // Игра идет
  currentMultiplier >= 1.01; // Множитель валиден
```

---

## Обработка на клиенте

```typescript
socket.on('error', (error) => {
  const msg = error.message;

  // Баланс
  if (msg.includes('Insufficient balance')) {
    showBalanceError();
    fetchUserBalance();
  }

  // Лимиты
  else if (msg.includes('Minimum bet')) {
    showMinBetError();
  } else if (msg.includes('Maximum bet')) {
    showMaxBetError();
  }

  // Игра
  else if (msg === 'Game is not accepting bets') {
    showGameClosedError();
  } else if (msg === 'You already have a bet on this game') {
    setHasBet(true);
  }

  // Кешаут
  else if (msg === 'Cannot cash out after plane has crashed') {
    showTooLateError();
  }

  // Прочее
  else {
    showGenericError(msg);
  }
});
```

---

## Логи для отладки

### Успешная ставка

```
✅ User abc123 placed bet of 100 on aviator game #456
```

### Недостаточный баланс

```
⚠️ User abc123 attempted to bet 100 with insufficient balance 50
```

### Race condition

```
❌ Race condition: User abc123 balance changed during transaction
```

---

## HTTP статус коды

- **400** - Bad Request (неверные данные)
- **403** - Forbidden (доступ запрещен)
- **404** - Not Found (не найдено)
- **500** - Internal Server Error (ошибка сервера)

---

## Настройки по умолчанию

```typescript
{
  minBet: 25,
  maxBet: 10000,
  minMultiplier: 1.0,
  maxMultiplier: 100000
}
```

---

## Полезные ссылки

- Полная документация: `AVIATOR_BET_VALIDATION.md`
- WebSocket события: `AVIATOR_WEBSOCKET_STATES.md`
- Исправление myBetId: `FIX_MYBET_ID_NULL.md`
