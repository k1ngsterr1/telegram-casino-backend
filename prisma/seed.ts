import { PrismaClient, SystemKey } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('\nSeeding system settings...');

  // Seed Telegram Bot Token
  await prisma.system.upsert({
    where: { key: SystemKey.TELEGRAM_BOT_TOKEN },
    update: { value: '8065350754:AAE4rUZ8UzYEIVqgibYQOGvHwfs2kJ3P06I' },
    create: {
      key: SystemKey.TELEGRAM_BOT_TOKEN,
      value: '8065350754:AAE4rUZ8UzYEIVqgibYQOGvHwfs2kJ3P06I',
    },
  });
  console.log('✓ Telegram bot token seeded');

  // Seed WebApp URL
  await prisma.system.upsert({
    where: { key: SystemKey.WEBAPP_URL },
    update: {},
    create: {
      key: SystemKey.WEBAPP_URL,
      value: process.env.WEBAPP_URL || 'http://localhost:5173',
    },
  });
  console.log('✓ WEBAPP_URL seeded');

  // Seed Telegram Session String (if provided in .env)
  if (process.env.TELEGRAM_SESSION_STRING) {
    await prisma.system.upsert({
      where: { key: SystemKey.TELEGRAM_SESSION_STRING },
      update: { value: process.env.TELEGRAM_SESSION_STRING },
      create: {
        key: SystemKey.TELEGRAM_SESSION_STRING,
        value: process.env.TELEGRAM_SESSION_STRING,
      },
    });
    console.log('✓ Telegram session string seeded from environment');
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🤖 TELEGRAM BOT');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Token: 8065350754:AAE4rUZ8UzYEIVqgibYQOGvHwfs2kJ3P06I');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('\nSeeding admin user...');

  // Create test admin user with strong credentials
  const adminLogin = 'superadmin';
  const adminPassword = 'Admin@2024!SecurePass';
  const hashedPassword = await bcrypt.hash(adminPassword, 10);

  await prisma.admin.upsert({
    where: { login: adminLogin },
    update: {
      password: hashedPassword,
    },
    create: {
      login: adminLogin,
      password: hashedPassword,
    },
  });

  console.log('✓ Admin user created');
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔐 ADMIN CREDENTIALS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Login:    ${adminLogin}`);
  console.log(`Password: ${adminPassword}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('\nSeeding test users...');

  // Create multiple test users
  const testUsers = [
    {
      telegramId: '123456789',
      username: 'testuser1',
      languageCode: 'en',
      balance: 1000,
      role: 'USER',
      isBanned: false,
    },
    {
      telegramId: '987654321',
      username: 'testuser2',
      languageCode: 'ru',
      balance: 500,
      role: 'USER',
      isBanned: false,
    },
    {
      telegramId: '555555555',
      username: 'richuser',
      languageCode: 'en',
      balance: 10000,
      role: 'USER',
      isBanned: false,
    },
    {
      telegramId: '111111111',
      username: 'pooruser',
      languageCode: 'ru',
      balance: 0,
      role: 'USER',
      isBanned: false,
    },
    {
      telegramId: '999999999',
      username: 'banneduser',
      languageCode: 'en',
      balance: 100,
      role: 'USER',
      isBanned: true,
    },
    {
      telegramId: '777777777',
      username: 'adminuser',
      languageCode: 'en',
      balance: 5000,
      role: 'ADMIN',
      isBanned: false,
    },
  ];

  for (const userData of testUsers) {
    await prisma.user.upsert({
      where: { telegramId: userData.telegramId },
      update: {
        balance: userData.balance,
        isBanned: userData.isBanned,
        role: userData.role as any,
      },
      create: userData as any,
    });
    console.log(
      `✓ User created: ${userData.username} (${userData.telegramId})`,
    );
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('👥 TEST USERS CREATED');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('testuser1    (123456789) - Balance: 1000  - EN - USER');
  console.log('testuser2    (987654321) - Balance: 500   - RU - USER');
  console.log('richuser     (555555555) - Balance: 10000 - EN - USER');
  console.log('pooruser     (111111111) - Balance: 0     - RU - USER');
  console.log('banneduser   (999999999) - Balance: 100   - EN - USER (BANNED)');
  console.log('adminuser    (777777777) - Balance: 5000  - EN - ADMIN');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('\nSeeding system settings...');

  // Seed default deposit settings
  const defaultDepositSettings = {
    minDeposit: 100,
    maxWithdrawal: 100000,
    withdrawalCommission: 5,
  };

  await prisma.system.upsert({
    where: { key: SystemKey.DEPOSIT },
    update: { value: JSON.stringify(defaultDepositSettings) },
    create: {
      key: SystemKey.DEPOSIT,
      value: JSON.stringify(defaultDepositSettings),
    },
  });

  console.log('✓ Default deposit settings created');
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('💰 DEPOSIT SETTINGS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Min Deposit:            ${defaultDepositSettings.minDeposit} ₽`);
  console.log(
    `Max Withdrawal:         ${defaultDepositSettings.maxWithdrawal} ₽`,
  );
  console.log(
    `Withdrawal Commission:  ${defaultDepositSettings.withdrawalCommission}%`,
  );
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Seed default aviator settings
  const defaultAviatorSettings = {
    minMultiplier: 1.0,
    maxMultiplier: 100000,
    minBet: 25,
    maxBet: 10000,
    targetRtp: 0.89,
    instantCrashP: 0.01,
  };

  await prisma.system.upsert({
    where: { key: SystemKey.AVIATOR },
    update: { value: JSON.stringify(defaultAviatorSettings) },
    create: {
      key: SystemKey.AVIATOR,
      value: JSON.stringify(defaultAviatorSettings),
    },
  });

  console.log('✓ Default aviator settings created');
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✈️  AVIATOR SETTINGS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Min Multiplier:    ${defaultAviatorSettings.minMultiplier}x`);
  console.log(`Max Multiplier:    ${defaultAviatorSettings.maxMultiplier}x`);
  console.log(`Min Bet:           ${defaultAviatorSettings.minBet} coins`);
  console.log(`Max Bet:           ${defaultAviatorSettings.maxBet} coins`);
  console.log(`Target RTP:        ${defaultAviatorSettings.targetRtp * 100}%`);
  console.log(
    `Instant Crash:     ${defaultAviatorSettings.instantCrashP * 100}%`,
  );
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Generate and seed server seed for provably fair system
  const crypto = require('crypto');
  const serverSeed = crypto.randomBytes(32).toString('hex');

  await prisma.system.upsert({
    where: { key: SystemKey.AVIATOR_SERVER_SEED },
    update: { value: serverSeed },
    create: {
      key: SystemKey.AVIATOR_SERVER_SEED,
      value: serverSeed,
    },
  });

  console.log('✓ Server seed generated for provably fair system');
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔐 PROVABLY FAIR SERVER SEED');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Server Seed: ${serverSeed}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('\nSeeding upgrade chances...');

  // Seed upgrade chances with realistic probabilities
  // Multipliers are now flexible and can be extended easily
  const upgradeChances = [
    { multiplier: 1.5, chance: 0.75 }, // 75% chance for 1.5x
    { multiplier: 2, chance: 0.5 }, // 50% chance for 2x
    { multiplier: 3, chance: 0.33 }, // 33% chance for 3x
    { multiplier: 5, chance: 0.2 }, // 20% chance for 5x
    { multiplier: 10, chance: 0.1 }, // 10% chance for 10x
  ];

  for (const upgradeData of upgradeChances) {
    await prisma.upgradeChance.upsert({
      where: { multiplier: upgradeData.multiplier },
      update: { chance: upgradeData.chance },
      create: upgradeData,
    });
  }

  console.log('✓ Upgrade chances configured');
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('⬆️  UPGRADE CHANCES (FLEXIBLE MULTIPLIERS)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  upgradeChances.forEach((u) =>
    console.log(`X${u.multiplier}: ${u.chance * 100}% chance`),
  );
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('\nSeeding prizes...');

  // Create prizes for cases with PNG images from Telegram CDN
  const prizes = [
    {
      name: '100 Coins',
      amount: 100,
      url: 'https://cdn.changes.tg/gifts/models/Candy%20Cane/png/Original.png',
    },
    {
      name: '250 Coins',
      amount: 250,
      url: 'https://cdn.changes.tg/gifts/models/Berry%20Box/png/Original.png',
    },
    {
      name: '500 Coins',
      amount: 500,
      url: 'https://cdn.changes.tg/gifts/models/Ice%20Cream/png/Original.png',
    },
    {
      name: '1000 Coins',
      amount: 1000,
      url: 'https://cdn.changes.tg/gifts/models/Homemade%20Cake/png/Original.png',
    },
    {
      name: '2500 Coins',
      amount: 2500,
      url: 'https://cdn.changes.tg/gifts/models/Precious%20Peach/png/Original.png',
    },
    {
      name: '5000 Coins',
      amount: 5000,
      url: 'https://cdn.changes.tg/gifts/models/Sakura%20Flower/png/Original.png',
    },
  ];

  const createdPrizes = [];
  for (let i = 0; i < prizes.length; i++) {
    const prizeData = prizes[i];
    const prize = await prisma.prize.upsert({
      where: { id: i + 1 },
      update: prizeData,
      create: { id: i + 1, ...prizeData },
    });
    createdPrizes.push(prize);
    console.log(`✓ Prize created: ${prizeData.name} (ID: ${prize.id})`);
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🎁 PRIZES CREATED');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  prizes.forEach((p) => console.log(`${p.name} - ${p.amount} coins`));
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('\nSeeding cases...');

  // Create cases with PNG previews from Telegram CDN
  const cases = [
    {
      id: 1,
      name: 'Bronze Case',
      price: 100,
      preview:
        'https://cdn.changes.tg/gifts/models/Loot%20Bag/png/Original.png',
    },
    {
      id: 2,
      name: 'Silver Case',
      price: 250,
      preview:
        'https://cdn.changes.tg/gifts/models/Joyful%20Bundle/png/Original.png',
    },
    {
      id: 3,
      name: 'Gold Case',
      price: 500,
      preview:
        'https://cdn.changes.tg/gifts/models/Heroic%20Helmet/png/Original.png',
    },
  ];

  for (const caseData of cases) {
    await prisma.case.upsert({
      where: { id: caseData.id },
      update: caseData,
      create: caseData,
    });
    console.log(`✓ Case created: ${caseData.name} (${caseData.price} coins)`);
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📦 CASES CREATED');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  cases.forEach((c) => console.log(`${c.name} - ${c.price} coins`));
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('\nSeeding case items...');

  // Create case items with chances
  const caseItems = [
    { name: 'Common Prize', chance: 0.5, prizeId: 1, caseId: 1 },
    { name: 'Uncommon Prize', chance: 0.3, prizeId: 2, caseId: 1 },
    { name: 'Rare Prize', chance: 0.15, prizeId: 3, caseId: 1 },
    { name: 'Epic Prize', chance: 0.05, prizeId: 4, caseId: 1 },
    { name: 'Uncommon Prize', chance: 0.4, prizeId: 2, caseId: 2 },
    { name: 'Rare Prize', chance: 0.35, prizeId: 3, caseId: 2 },
    { name: 'Epic Prize', chance: 0.2, prizeId: 4, caseId: 2 },
    { name: 'Legendary Prize', chance: 0.05, prizeId: 5, caseId: 2 },
    { name: 'Rare Prize', chance: 0.3, prizeId: 3, caseId: 3 },
    { name: 'Epic Prize', chance: 0.35, prizeId: 4, caseId: 3 },
    { name: 'Legendary Prize', chance: 0.25, prizeId: 5, caseId: 3 },
    { name: 'Mythic Prize', chance: 0.1, prizeId: 6, caseId: 3 },
  ];

  for (const itemData of caseItems) {
    await prisma.caseItem.create({
      data: itemData,
    });
  }

  console.log(`✓ ${caseItems.length} case items created\n`);

  console.log('\nSeeding transactions data...');

  // Get all users
  const allUsers = await prisma.user.findMany();
  const activeUsers = allUsers.filter((u) => !u.isBanned);

  if (activeUsers.length === 0) {
    console.log('⚠️  No active users found. Skipping transaction seeding.');
  } else {
    // Create aviator games with different dates (last 7 days)
    const now = new Date();
    const aviatorGames = [];

    for (let i = 6; i >= 0; i--) {
      const gameDate = new Date(now);
      gameDate.setDate(gameDate.getDate() - i);
      gameDate.setHours(10 + (i % 12), 0, 0, 0);

      // Create 3-5 games per day
      const gamesPerDay = 3 + Math.floor(Math.random() * 3);
      for (let j = 0; j < gamesPerDay; j++) {
        const gameTime = new Date(gameDate);
        gameTime.setHours(gameTime.getHours() + j * 2);

        const multiplier = 1.0 + Math.random() * 10; // Random multiplier 1.0 - 11.0
        const aviator = await prisma.aviator.create({
          data: {
            startsAt: gameTime,
            multiplier: multiplier,
            status: 'FINISHED',
            clientSeed: crypto.randomBytes(16).toString('hex'),
            nonce: j,
          },
        });
        aviatorGames.push(aviator);
      }
    }

    console.log(`✓ Created ${aviatorGames.length} aviator games`);

    // Create bets for aviator games
    let totalBets = 0;
    for (const game of aviatorGames) {
      // Random number of bets per game (1-4)
      const betsCount = 1 + Math.floor(Math.random() * 4);

      for (let i = 0; i < betsCount; i++) {
        const user =
          activeUsers[Math.floor(Math.random() * activeUsers.length)];
        const betAmount = [25, 50, 100, 200, 500, 1000][
          Math.floor(Math.random() * 6)
        ];

        // 60% chance of cashing out
        const didCashout = Math.random() < 0.6;
        const cashedAt = didCashout
          ? 1.0 + Math.random() * Number(game.multiplier) * 0.8 // Cash out before crash
          : null;

        await prisma.bet.create({
          data: {
            aviatorId: game.id,
            userId: user.id,
            amount: betAmount,
            cashedAt: cashedAt,
            createdAt: game.startsAt,
            updatedAt: game.startsAt,
          },
        });
        totalBets++;
      }
    }

    console.log(`✓ Created ${totalBets} bets`);

    // Create case openings (inventory items)
    let totalCaseOpenings = 0;
    for (let i = 6; i >= 0; i--) {
      const day = new Date(now);
      day.setDate(day.getDate() - i);

      // Random case openings per day (2-8)
      const openingsPerDay = 2 + Math.floor(Math.random() * 7);

      for (let j = 0; j < openingsPerDay; j++) {
        const user =
          activeUsers[Math.floor(Math.random() * activeUsers.length)];
        const caseToOpen = cases[Math.floor(Math.random() * cases.length)];
        const randomPrize =
          createdPrizes[Math.floor(Math.random() * createdPrizes.length)];

        const openingTime = new Date(day);
        openingTime.setHours(8 + j * 2, Math.floor(Math.random() * 60), 0, 0);

        await prisma.inventoryItem.create({
          data: {
            userId: user.id,
            prizeId: randomPrize.id,
            caseId: caseToOpen.id,
            createdAt: openingTime,
            updatedAt: openingTime,
          },
        });
        totalCaseOpenings++;
      }
    }

    console.log(`✓ Created ${totalCaseOpenings} case openings`);

    // Create payments (deposits)
    let totalPayments = 0;
    for (let i = 6; i >= 0; i--) {
      const day = new Date(now);
      day.setDate(day.getDate() - i);

      // Random payments per day (1-4)
      const paymentsPerDay = 1 + Math.floor(Math.random() * 4);

      for (let j = 0; j < paymentsPerDay; j++) {
        const user =
          activeUsers[Math.floor(Math.random() * activeUsers.length)];
        const amount = [100, 250, 500, 1000, 2500, 5000][
          Math.floor(Math.random() * 6)
        ];

        const paymentTime = new Date(day);
        paymentTime.setHours(6 + j * 4, Math.floor(Math.random() * 60), 0, 0);

        // 90% completed, 5% pending, 5% failed
        const statusRand = Math.random();
        const status =
          statusRand < 0.9
            ? 'COMPLETED'
            : statusRand < 0.95
              ? 'PENDING'
              : 'FAILED';

        await prisma.payment.create({
          data: {
            userId: user.id,
            amount: amount,
            currency: 'XTR',
            status: status,
            invoiceId: `inv_${crypto.randomBytes(8).toString('hex')}`,
            createdAt: paymentTime,
            updatedAt: paymentTime,
          },
        });
        totalPayments++;
      }
    }

    console.log(`✓ Created ${totalPayments} payments`);

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('💰 TRANSACTION DATA SEEDED');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Aviator Games:    ${aviatorGames.length}`);
    console.log(`Bets:             ${totalBets}`);
    console.log(`Case Openings:    ${totalCaseOpenings}`);
    console.log(`Payments:         ${totalPayments}`);
    console.log(
      `Total Transactions: ~${totalBets * 2 + totalCaseOpenings + totalPayments} (including wins)`,
    );
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  }

  console.log('Seeding complete!');
  console.log('Remember to set TELEGRAM_BOT_TOKEN via the admin API endpoint.');
}

main()
  .catch((e) => {
    console.error(e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
