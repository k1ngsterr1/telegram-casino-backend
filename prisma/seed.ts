import { PrismaClient, SystemKey } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  // Note: TELEGRAM_BOT_TOKEN should be set manually via the API for security
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
