import { Injectable, HttpException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../shared/services/prisma.service';
import * as bcrypt from 'bcrypt';
import { AdminLoginDto } from './dto/admin-login.dto';
import { AdminResponseDto } from './dto/admin-response.dto';
import { Role } from '@prisma/client';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async adminLogin(dto: AdminLoginDto): Promise<AdminResponseDto> {
    const admin = await this.prisma.admin.findUnique({
      where: { login: dto.login },
    });

    if (!admin) {
      throw new HttpException('Invalid credentials', 401);
    }

    const isPasswordValid = await bcrypt.compare(dto.password, admin.password);
    const user = await this.prisma.user.findUnique({
      where: { telegramId: dto.telegramId },
    });

    if (!isPasswordValid) {
      throw new HttpException('Invalid credentials', 401);
    }

    const payload = {
      id: user.id,
      role: Role.ADMIN,
    };

    const accessToken = this.jwtService.sign(payload);

    return {
      accessToken,
      adminId: admin.id,
      login: admin.login,
    };
  }

  async validateAdmin(adminId: string) {
    return this.prisma.admin.findUnique({
      where: { id: adminId },
      select: { id: true, login: true },
    });
  }
}
