import { LanguageCode } from '@prisma/client';

export const messages = {
  [LanguageCode.en]: {
    payment: {
      title: 'Casino Bot',
      description: 'Deposit',
      label: 'Deposit',
      success:
        'Thank you for your purchase! Your payment has been successfully processed. 🎉',
      failed: 'Failed to confirm payment',
      invalidRequest: 'Invalid payment request.',
      notFound: 'Payment not found.',
      processingError: 'An error occurred while processing your payment.',
    },
    bot: {
      welcome: 'Welcome to Casino Bot!',
      buttonText: '🎮 Casino Bot',
      unknownCommand:
        'Unknown command. Use /help for a list of available commands.',
    },
  },
  [LanguageCode.ru]: {
    payment: {
      title: 'Казино Бот',
      description: 'Пополнение',
      label: 'Пополнение',
      success: 'Спасибо за вашу покупку! Ваш платеж успешно обработан. 🎉',
      failed: 'Не удалось подтвердить оплату',
      invalidRequest: 'Неверный запрос на оплату.',
      notFound: 'Платеж не найден.',
      processingError: 'Произошла ошибка при обработке вашего платежа.',
    },
    bot: {
      welcome: 'Добро пожаловать в Казино Бот!',
      buttonText: '🎮 Казино Бот',
      unknownCommand:
        'Неизвестная команда. Используйте /help для списка доступных команд.',
    },
  },
};

export function getMessage(languageCode: LanguageCode, key: string): string {
  const keys = key.split('.');
  let message: any = messages[languageCode];

  for (const k of keys) {
    message = message?.[k];
  }

  return message || key;
}
