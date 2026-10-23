import type { FastifyInstance } from 'fastify';
import type { Config } from '../config/env.js';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../domain/password.js';
import { clearSessionCookie, getSessionId, requireUser, setSessionCookie } from '../plugins/auth.js';
import { rateLimitHook } from '../plugins/rate-limit.js';
import type { AuthService } from '../services/auth.service.js';
import type { RateLimiter } from '../services/rate-limiter.js';
import type { SessionStore } from '../services/session-store.js';

interface Credentials {
  email: string;
  password: string;
}

const credentialsSchema = {
  body: {
    type: 'object',
    required: ['email', 'password'],
    additionalProperties: false,
    properties: {
      email: { type: 'string', format: 'email', maxLength: 254 },
      password: { type: 'string', minLength: PASSWORD_MIN_LENGTH, maxLength: PASSWORD_MAX_LENGTH },
    },
  },
};

export function authRoutes(
  app: FastifyInstance,
  authService: AuthService,
  sessions: SessionStore,
  rateLimiter: RateLimiter,
  config: Config,
): void {
  const secureCookie = config.BASE_URL.startsWith('https://');
  const limitByIp = rateLimitHook(rateLimiter, (request) => [
    { key: `rl:auth:ip:${request.ip}`, max: config.AUTH_RATE_LIMIT_PER_IP, windowSeconds: 60 },
  ]);

  app.post<{ Body: Credentials }>(
    '/api/auth/register',
    { schema: credentialsSchema, onRequest: limitByIp },
    async (request, reply) => {
      const user = await authService.register(request.body.email, request.body.password);
      setSessionCookie(reply, await sessions.create(user), config.SESSION_TTL_SECONDS, secureCookie);
      return reply.status(201).send({ user });
    },
  );

  app.post<{ Body: Credentials }>(
    '/api/auth/login',
    { schema: credentialsSchema, onRequest: limitByIp },
    async (request, reply) => {
      const user = await authService.login(request.body.email, request.body.password);
      setSessionCookie(reply, await sessions.create(user), config.SESSION_TTL_SECONDS, secureCookie);
      return reply.send({ user });
    },
  );

  app.post('/api/auth/logout', async (request, reply) => {
    const sessionId = getSessionId(request);
    if (sessionId) {
      await sessions.destroy(sessionId);
    }
    clearSessionCookie(reply);
    return reply.status(204).send();
  });

  app.get('/api/auth/me', async (request) => ({ user: requireUser(request) }));
}
