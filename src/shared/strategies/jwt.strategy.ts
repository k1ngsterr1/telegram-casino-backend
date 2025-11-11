import { HttpException, Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../services/prisma.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly prisma: PrismaService,
    configService: ConfigService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
    });
  }

  async validate(payload: any) {
    try {
      console.log(
        '🔐 JWT Validation - Payload:',
        JSON.stringify(payload, null, 2),
      );

      // Check if token is for admin (has isAdmin flag)
      if (payload.isAdmin === true) {
        console.log('👤 Checking Admin table for ID:', payload.id);
        const admin = await this.prisma.admin.findUnique({
          where: { id: payload.id },
          select: {
            id: true,
            login: true,
          },
        });

        if (!admin) {
          console.error('❌ Admin not found in database:', payload.id);
          throw new HttpException('Admin not found', 401);
        }

        console.log('✅ Admin validated:', admin.login);
        return {
          id: admin.id,
          isAdmin: true,
          login: admin.login,
        };
      }

      // Otherwise validate against User table
      console.log('👤 Checking User table for ID:', payload.id);
      const user = await this.prisma.user.findUnique({
        where: { id: payload.id },
        select: {
          id: true,
          isBanned: true,
          role: true,
        },
      });

      if (!user) {
        console.error('❌ User not found in database:', payload.id);
        throw new HttpException('User not found', 401);
      }

      if (user.isBanned) {
        console.error('❌ User is banned:', payload.id);
        throw new HttpException('User is banned', 401);
      }

      console.log('✅ User validated:', user.id);
      return {
        id: user.id,
        isBanned: user.isBanned,
        role: user.role,
        isAdmin: false,
      };
    } catch (error) {
      console.error('💥 JWT Validation Error:', error.message);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException('Invalid token', 401);
    }
  }
}
