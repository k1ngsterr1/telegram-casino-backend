import { PrismaClient, SystemKey } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  await prisma.system.upsert({
    where: { key: SystemKey.TELEGRAM_BOT_TOKEN },
    update: { value: '8065350754:AAE4rUZ8UzYEIVqgibYQOGvHwfs2kJ3P06I' },
    create: {
      key: SystemKey.TELEGRAM_BOT_TOKEN,
      value: '8065350754:AAE4rUZ8UzYEIVqgibYQOGvHwfs2kJ3P06I',
    },
  });
}

main()
  .catch((e) => {
    console.error(e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
