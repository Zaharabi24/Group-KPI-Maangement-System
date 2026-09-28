import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  SetPasswordDto,
} from './dto/auth.dto';
import { CurrentUser, IdempotencyKey, Public, RequestMeta } from '../../common/decorators';
import { AuthUser, RequestContextMeta } from '../../common/interfaces/auth-user.interface';
import { evaluatePasswordPolicy } from './password.util';

const REFRESH_COOKIE = 'anwar_rt';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // ---------------------------------------------------------------- FR-AUTH-01/04

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() dto: RegisterDto, @RequestMeta() meta: RequestContextMeta) {
    return this.auth.register(dto, meta);
  }

  @Public()
  @Post('resend-activation')
  @HttpCode(HttpStatus.OK)
  async resend(@Body() dto: ForgotPasswordDto, @RequestMeta() meta: RequestContextMeta) {
    return this.auth.resendActivation(dto.email, meta);
  }

  @Public()
  @Get('token/:token')
  async inspect(@Param('token') token: string) {
    return this.auth.inspectToken(token);
  }

  // -------------------------------------------------------------- FR-AUTH-05/06/09

  @Public()
  @Post('set-password')
  @HttpCode(HttpStatus.OK)
  async setPassword(@Body() dto: SetPasswordDto, @RequestMeta() meta: RequestContextMeta) {
    return this.auth.setPassword(dto.token, dto.password, dto.confirmPassword, meta);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto, @RequestMeta() meta: RequestContextMeta) {
    return this.auth.setPassword(dto.token, dto.password, dto.confirmPassword, meta);
  }

  @Public()
  @Post('password-policy')
  @HttpCode(HttpStatus.OK)
  policy(@Body() body: { password?: string; email?: string }) {
    return {
      policy: this.auth.policy(body?.email),
      evaluation: evaluatePasswordPolicy(body?.password ?? '', body?.email),
    };
  }

  // -------------------------------------------------------------------- FR-AUTH-07

  @Public()
  @Throttle({ default: { limit: Number(process.env.RATE_LIMIT_LOGIN_PER_MIN ?? 10), ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @RequestMeta() meta: RequestContextMeta,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.login(dto, meta);
    this.setRefreshCookie(res, result.refreshToken, result.refreshTokenExpiresAt);
    const { refreshToken: _rt, ...safe } = result;
    return safe;
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Body() body: { refreshToken?: string },
    @RequestMeta() meta: RequestContextMeta,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = body?.refreshToken || (req.cookies?.[REFRESH_COOKIE] as string | undefined) || '';
    const result = await this.auth.refresh(token, meta);
    this.setRefreshCookie(res, result.refreshToken, result.refreshTokenExpiresAt);
    const { refreshToken: _rt, ...safe } = result;
    return safe;
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: Request,
    @CurrentUser() user: AuthUser,
    @Body() body: { refreshToken?: string },
    @RequestMeta() meta: RequestContextMeta,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = body?.refreshToken || (req.cookies?.[REFRESH_COOKIE] as string | undefined);
    const result = await this.auth.logout(token, user.id, user.sessionId, meta);
    res.clearCookie(REFRESH_COOKIE, { path: '/' });
    return result;
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgot(@Body() dto: ForgotPasswordDto, @RequestMeta() meta: RequestContextMeta) {
    return this.auth.forgotPassword(dto.email, meta);
  }

  // -------------------------------------------------------------------- FR-PRF-04

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() user: AuthUser,
    @RequestMeta() meta: RequestContextMeta,
  ) {
    return this.auth.changePassword(user.id, dto.currentPassword, dto.newPassword, dto.confirmPassword, meta);
  }

  @Get('sessions')
  async sessions(@CurrentUser() user: AuthUser) {
    return this.auth.sessions(user.id);
  }

  @Delete('sessions/:id')
  async revoke(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @RequestMeta() meta: RequestContextMeta,
  ) {
    return this.auth.revokeSession(user.id, id, meta);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return user;
  }

  private setRefreshCookie(res: Response, token: string, expiresAt: Date): void {
    // SameSite=Strict is correct when the SPA and the API share an origin
    // (Docker/Nginx). For a split deployment (Vercel + a separate API host) set
    // COOKIE_SAMESITE=none together with COOKIE_SECURE=true over HTTPS.
    const sameSite = (process.env.COOKIE_SAMESITE ?? 'strict').toLowerCase();
    const secure = String(process.env.COOKIE_SECURE ?? 'false') === 'true';

    res.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: secure || sameSite === 'none',
      sameSite: sameSite === 'none' ? 'none' : sameSite === 'lax' ? 'lax' : 'strict',
      path: '/',
      expires: expiresAt,
      domain: process.env.COOKIE_DOMAIN || undefined,
    });
  }
}
