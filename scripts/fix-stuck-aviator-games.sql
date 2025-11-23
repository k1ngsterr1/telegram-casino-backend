-- Скрипт для исправления застрявших игр Aviator

-- 1. Проверить текущее состояние игр
SELECT 
    id,
    status,
    multiplier,
    startsAt,
    createdAt,
    updatedAt,
    (SELECT COUNT(*) FROM Bet WHERE aviatorId = Aviator.id) as bet_count
FROM Aviator
WHERE status IN ('WAITING', 'ACTIVE')
ORDER BY createdAt DESC
LIMIT 5;

-- 2. Показать игры, которые должны были уже стартовать но застряли
SELECT 
    id,
    status,
    startsAt,
    NOW() as current_time,
    TIMESTAMPDIFF(SECOND, startsAt, NOW()) as seconds_overdue
FROM Aviator
WHERE status = 'WAITING' 
  AND startsAt < NOW()
ORDER BY startsAt ASC;

-- 3. Показать игры ACTIVE, которые должны были крашнуться
SELECT 
    id,
    status,
    multiplier,
    startsAt,
    NOW() as current_time,
    TIMESTAMPDIFF(SECOND, startsAt, NOW()) as seconds_since_start
FROM Aviator
WHERE status = 'ACTIVE'
ORDER BY startsAt ASC;

-- 4. ИСПРАВЛЕНИЕ: Завершить все застрявшие игры
-- ВНИМАНИЕ: Это завершит все WAITING и ACTIVE игры!
-- Раскомментируйте следующую строку для выполнения:

-- UPDATE Aviator SET status = 'FINISHED', updatedAt = NOW() WHERE status IN ('WAITING', 'ACTIVE');

-- 5. После выполнения UPDATE, проверить результат:
-- SELECT COUNT(*) as finished_games, status FROM Aviator GROUP BY status;

-- 6. АЛЬТЕРНАТИВА: Завершить только старые застрявшие игры (старше 5 минут)
-- UPDATE Aviator 
-- SET status = 'FINISHED', updatedAt = NOW() 
-- WHERE status IN ('WAITING', 'ACTIVE') 
--   AND createdAt < DATE_SUB(NOW(), INTERVAL 5 MINUTE);
