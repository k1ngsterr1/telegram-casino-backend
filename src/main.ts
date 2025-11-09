import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { BadRequestException, Logger, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const NODE_ENV = process.env.NODE_ENV;
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');
  if (NODE_ENV !== 'production') {
    app.setGlobalPrefix('api');
  }
  app.enableCors({
    origin: ['https://gifty-realm-production.up.railway.app'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'Accept',
      'Origin',
    ],
    exposedHeaders: ['Authorization'],
  });

  if (NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Arctic pay API')
      .setDescription('Arctic pay API endpoints')
      .setVersion('1.0')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          in: 'header',
        },
        'JWT',
      )
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document, {
      swaggerOptions: {
        operationsSorter: (a: any, b: any) => {
          // 1) Make order a Record<string,number> so indexing by any string is allowed
          const order: Record<string, number> = {
            post: 1,
            patch: 2,
            delete: 3,
            get: 4,
          };

          // 2) Cast a.get('method') to string, then lowercase
          const methodA = (a.get('method') as string).toLowerCase();
          const methodB = (b.get('method') as string).toLowerCase();

          // 3) Now safe to index
          const rankA = order[methodA] ?? 99;
          const rankB = order[methodB] ?? 99;

          if (rankA < rankB) return -1;
          if (rankA > rankB) return 1;
          // fallback to path compare
          const pathA = a.get('path') as string;
          const pathB = b.get('path') as string;
          return pathA.localeCompare(pathB);
        },
      },
    });
  }

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) => {
        logger.error(errors);
        return new BadRequestException(errors);
      },
    }),
  );

  const port = Number(process.env.PORT ?? 6001);
  await app.listen(port);
  logger.log(`HTTP server listening on http://localhost:${port}`);
}
bootstrap();
