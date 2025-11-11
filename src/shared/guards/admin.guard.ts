// admin.guard.ts
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
} from '@nestjs/common';

type JwtUser = {
  id: string;
  isAdmin?: boolean;
  login?: string;
};

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ user?: JwtUser }>();
    const user = req.user;

    console.log(
      '🛡️  AdminGuard - User from request:',
      JSON.stringify(user, null, 2),
    );

    if (!user) {
      console.error('❌ AdminGuard - No user in request');
      throw new HttpException('User not authenticated', 401);
    }
    if (user.isAdmin !== true) {
      console.error(
        '❌ AdminGuard - User is not admin. isAdmin:',
        user.isAdmin,
      );
      throw new HttpException('Access denied: Admins only', 403);
    }
    console.log('✅ AdminGuard - Access granted to admin:', user.id);
    return true;
  }
}
