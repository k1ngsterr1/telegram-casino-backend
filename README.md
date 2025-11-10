<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://coveralls.io/github/nestjs/nest?branch=master" target="_blank"><img src="https://coveralls.io/repos/github/nestjs/nest/badge.svg?branch=master#9" alt="Coverage" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

Telegram Casino Backend - A NestJS backend for a Telegram Mini App casino game featuring:

- 🎰 **Casino Games**: Case opening system and Aviator crash game
- 🔐 **Provably Fair**: HMAC-SHA256 based algorithm for verifiable game outcomes
- 🤖 **Telegram Integration**: Grammy bot framework with WebApp support
- 🔑 **JWT Authentication**: Secure user authentication via Telegram initData
- 💾 **PostgreSQL + Prisma**: Type-safe database access
- 👨‍💼 **Admin Panel**: Complete admin API for game management
- 💰 **Payment System**: Telegram Stars integration

## Key Features

### Provably Fair Aviator Game

The Aviator crash game implements a cryptographically secure provably fair algorithm:

- HMAC-SHA256 based multiplier generation
- Server seed + client seed + nonce verification
- Configurable RTP (Return to Player) and crash probabilities
- Full transparency for players to verify game outcomes

📖 [Read Provably Fair Documentation](docs/PROVABLY_FAIR.md)

### Architecture

- **SharedModule**: Global services (Prisma, Bot, JWT, Cron, Referral)
- **UserModule**: Public endpoints for authentication and profiles
- **AdminModule**: Protected admin endpoints for game and user management
- **WebSocket Gateway**: Real-time game updates

📖 [Development Instructions](.github/copilot-instructions.md)

## Quick Start

### Prerequisites

- Node.js 18+ and Yarn
- PostgreSQL database
- Telegram Bot Token (from [@BotFather](https://t.me/BotFather))

## Project setup

```bash
# Install dependencies
$ yarn install

# Set up environment variables
$ cp .env.example .env
# Edit .env with your database URL and JWT secret

# Run database migrations
$ yarn prisma migrate dev

# Seed database (creates admin user and default settings)
$ yarn prisma db seed

# Generate Prisma Client
$ yarn prisma generate
```

### Environment Variables

Create a `.env` file in the root directory:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/telegram_casino
JWT_SECRET=your-secret-key-here
WEBAPP_URL=https://your-webapp.com
PORT=3000
```

## Compile and run the project

```bash
# development
$ yarn run start

# watch mode
$ yarn run start:dev

# production mode
$ yarn run start:prod
```

## Run tests

```bash
# unit tests
$ yarn run test

# e2e tests
$ yarn run test:e2e

# test coverage
$ yarn run test:cov
```

## Project Structure

```
src/
├── admin/          # Admin-only endpoints (users, cases, prizes, aviator)
├── auth/           # Admin authentication
├── case/           # Case opening game endpoints
├── payment/        # Payment processing (Telegram Stars)
├── shared/         # Global services and utilities
│   ├── services/   # Prisma, Bot, JWT, Cron, Referral
│   ├── guards/     # Authentication guards
│   └── strategies/ # JWT strategy
├── system/         # System settings management
├── user/           # User authentication and profiles
└── websocket/      # Real-time game updates

prisma/
├── schema.prisma   # Database schema
├── seed.ts         # Database seeding
└── migrations/     # Migration history

docs/
├── PROVABLY_FAIR.md              # Provably fair algorithm docs
├── PROVABLY_FAIR_IMPLEMENTATION.md  # Implementation guide
├── PROVABLY_FAIR_QUICKREF.md     # Quick reference
└── MIGRATION_PROVABLY_FAIR.sql   # Migration notes
```

## API Endpoints

### Public Endpoints

- `POST /user/telegram` - Authenticate via Telegram WebApp
- `GET /user/profile` - Get user profile
- `GET /case` - List all cases
- `POST /case/:id/open` - Open a case

### Admin Endpoints (require admin token)

- `GET /admin/aviator/settings` - Get aviator settings
- `PUT /admin/aviator/settings` - Update aviator settings
- `GET /admin/aviator/server-seed` - Get server seed
- `PUT /admin/aviator/server-seed` - Update server seed
- `GET /admin/user` - List all users
- `PUT /admin/user/:id/ban` - Ban/unban user
- `GET /admin/case` - Manage cases
- `GET /admin/prize` - Manage prizes

📖 Full API documentation available at `/api` when running the server (Swagger UI)

## Database Management

```bash
# Create a new migration
$ yarn prisma migrate dev --name migration_name

# Apply migrations in production
$ yarn prisma migrate deploy

# Open Prisma Studio (visual database editor)
$ yarn prisma studio

# Reset database (⚠️ deletes all data)
$ yarn prisma migrate reset
```

## Provably Fair System

The Aviator game uses HMAC-SHA256 for provably fair outcomes:

```typescript
multiplier = HMAC - SHA256(serverSeed, 'clientSeed:nonce');
```

**Admin can configure**:

- Target RTP (default 89%)
- Instant crash probability (default 1%)
- Min/max multipliers
- Server seed

**Players can verify**:

- Each game's client seed and nonce are public
- Server seed can be revealed after games
- Independent verification using the same algorithm

See [docs/PROVABLY_FAIR.md](docs/PROVABLY_FAIR.md) for details.

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ yarn install -g mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
