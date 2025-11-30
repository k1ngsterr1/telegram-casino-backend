const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const readline = require('readline');

const apiId = 31460765;
const apiHash = 'ab98831c92df6b547f747d30c35a9e4f';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const input = (question) =>
  new Promise((resolve) => {
    rl.question(question, resolve);
  });

(async () => {
  console.log('🚀 Telegram Session Generator');
  console.log('================================');

  const stringSession = new StringSession('');
  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
  });

  try {
    await client.start({
      phoneNumber: async () =>
        await input(
          'Введите ваш номер телефона (с кодом страны, например +79001234567): ',
        ),
      password: async () => await input('Введите пароль 2FA (если есть): '),
      phoneCode: async () =>
        await input('Введите код подтверждения из Telegram: '),
      onError: (err) => console.error('Ошибка:', err),
    });

    console.log('✅ Успешно подключился к Telegram!');
    console.log('================================');
    console.log('Ваш session string:');
    console.log(client.session.save());
    console.log('================================');
    console.log(
      'Скопируйте эту строку и добавьте её в .env как TELEGRAM_SESSION_STRING',
    );

    await client.disconnect();
  } catch (error) {
    console.error('❌ Ошибка при создании сессии:', error);
  }

  rl.close();
})();
