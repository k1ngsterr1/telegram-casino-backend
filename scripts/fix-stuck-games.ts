import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function fixStuckGames() {
  console.log('🔧 Fixing stuck Aviator games...\n');

  try {
    // 1. Показать текущие застрявшие игры
    const stuckGames = await prisma.aviator.findMany({
      where: {
        status: {
          in: ['WAITING', 'ACTIVE'],
        },
        createdAt: {
          lt: new Date(Date.now() - 5 * 60 * 1000), // Старше 5 минут
        },
      },
      select: {
        id: true,
        status: true,
        multiplier: true,
        startsAt: true,
        createdAt: true,
        _count: {
          select: {
            bets: true,
          },
        },
      },
    });

    if (stuckGames.length === 0) {
      console.log('✅ No stuck games found!');
      return;
    }

    console.log(`Found ${stuckGames.length} stuck games:\n`);

    stuckGames.forEach((game) => {
      const createdAgo = Math.floor(
        (Date.now() - game.createdAt.getTime()) / 1000 / 60,
      );
      console.log(`  Game #${game.id}:`);
      console.log(`    Status: ${game.status}`);
      console.log(`    Multiplier: ${game.multiplier}x`);
      console.log(`    Created: ${createdAgo} minutes ago`);
      console.log(`    Bets: ${game._count.bets}`);
      console.log(``);
    });

    // 2. Завершить застрявшие игры
    const result = await prisma.aviator.updateMany({
      where: {
        status: {
          in: ['WAITING', 'ACTIVE'],
        },
        createdAt: {
          lt: new Date(Date.now() - 5 * 60 * 1000),
        },
      },
      data: {
        status: 'FINISHED',
        updatedAt: new Date(),
      },
    });

    console.log(`✅ Fixed ${result.count} stuck games!\n`);

    // 3. Показать статистику
    const stats = await prisma.aviator.groupBy({
      by: ['status'],
      _count: {
        status: true,
      },
    });

    console.log('📊 Current game statistics:');
    stats.forEach((stat) => {
      console.log(`  ${stat.status}: ${stat._count.status} games`);
    });
  } catch (error) {
    console.error('❌ Error fixing stuck games:', error);
  } finally {
    await prisma.$disconnect();
  }
}

fixStuckGames();
