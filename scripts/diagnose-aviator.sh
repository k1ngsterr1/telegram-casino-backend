#!/bin/bash

# Скрипт для диагностики проблемы с застрявшей игрой Aviator

echo "🔍 Диагностика проблемы с Aviator..."
echo ""

# Цвета для вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Что нужно проверить:${NC}"
echo ""
echo "1. ✅ Игровой цикл запустился при старте приложения"
echo "   Ищите в логах: '🎮 Starting aviator game loop...'"
echo "   Ищите в логах: '✅ Game loop started successfully'"
echo ""

echo "2. ✅ updateGameState() вызывается каждую секунду"
echo "   Ищите в логах: '⏳ Game #XXXX WAITING: Xs until start'"
echo ""

echo "3. ✅ Игра переходит из WAITING в ACTIVE после таймера"
echo "   Ищите в логах: '🚀 Game #XXXX transitioning from WAITING to ACTIVE'"
echo ""

echo "4. ✅ Игра крашится и переходит в FINISHED"
echo "   Ищите в логах: '💥 Game #XXXX transitioning from ACTIVE to FINISHED'"
echo ""

echo -e "${YELLOW}Возможные проблемы:${NC}"
echo ""
echo "❌ Проблема 1: Игровой цикл не запускается"
echo "   Решение: Проверьте что WebsocketGateway загружается"
echo "   Команда: grep 'Starting aviator game loop' логи"
echo ""

echo "❌ Проблема 2: startsAt в будущем слишком далеко"
echo "   Решение: Проверьте startsAt игры в БД"
echo "   Команда SQL:"
echo "   SELECT id, status, startsAt, multiplier FROM Aviator WHERE status = 'WAITING';"
echo ""

echo "❌ Проблема 3: Игра застряла в старом состоянии"
echo "   Решение: Сбросить застрявшую игру"
echo "   Команда SQL:"
echo "   UPDATE Aviator SET status = 'FINISHED' WHERE status IN ('WAITING', 'ACTIVE');"
echo ""

echo "❌ Проблема 4: currentGameId не установлен"
echo "   Решение: Проверьте логи на '⚠️ updateGameState called but currentGameId is null'"
echo ""

echo -e "${GREEN}Запуск диагностики в реальном времени:${NC}"
echo ""
echo "Следите за логами сервера. Должны появиться новые сообщения:"
echo "  - Каждую секунду: '⏳ Game #XXXX WAITING: Xs until start'"
echo "  - Через 5 секунд: '🚀 Game #XXXX transitioning from WAITING to ACTIVE'"
echo ""

read -p "Нажмите Enter чтобы начать мониторинг логов (Ctrl+C для выхода)..."

# Если используется PM2
if command -v pm2 &> /dev/null; then
    echo ""
    echo "Используется PM2. Показываю логи:"
    pm2 logs --lines 100
else
    echo ""
    echo "PM2 не найден. Запустите приложение и следите за логами вручную."
fi
