import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import { registerAuthRoutes } from '../../src/routes/auth.js';

// Mock bcrypt
vi.mock('bcrypt', () => ({
  default: {
    hash: vi.fn().mockResolvedValue('hashed_password_123'),
    compare: vi.fn().mockResolvedValue(true),
  },
}));

// Mock fastifyJwt
vi.mock('@fastify/jwt', () => ({
  default: vi.fn(async function (_opts: any, _app: any, done: () => void) {
    done();
  }),
}));

function createMockPrisma() {
  const users: Map<string, { id: string; email: string; password: string }> = new Map();

  return {
    user: {
      findUnique: vi.fn().mockImplementation(async ({ where }: { where: { email: string } }) => {
        return Array.from(users.values()).find(u => u.email === where.email) ?? null;
      }),
      create: vi.fn().mockImplementation(async ({ data }: { data: { email: string; password: string } }) => {
        const user = { id: `user-${Date.now()}`, email: data.email, password: data.password };
        users.set(user.email, user);
        return { id: user.id, email: user.email };
      }),
    },
    $connect: vi.fn(),
    $disconnect: vi.fn(),
  };
}

function buildTestApp(prisma: ReturnType<typeof createMockPrisma>) {
  const app = Fastify();

  // Decorate with mock prisma
  app.decorate('prisma', prisma);

  // Mock config
  app.decorate('config', {
    NODE_ENV: 'test',
    API_PORT: 3002,
    DATABASE_URL: 'postgresql://localhost:5432/test',
    JWT_ACCESS_SECRET: 'test-access-secret',
    JWT_REFRESH_SECRET: 'test-refresh-secret',
    UPLOADS_DIR: '/uploads',
    OLLAMA_BASE_URL: 'http://localhost:11434',
    OLLAMA_EMBEDDING_MODEL: 'llama3.2:3b',
    OLLAMA_CHAT_MODEL: 'llama3.2:3b',
  });

  // Mock jwt.sign
  app.jwt = {
    sign: vi.fn().mockReturnValue('mock-jwt-token'),
  } as any;

  return app;
}

describe('auth routes', () => {
  let app: ReturnType<typeof buildTestApp>;
  let mockPrisma: ReturnType<typeof createMockPrisma>;

  beforeEach(async () => {
    mockPrisma = createMockPrisma();
    app = buildTestApp(mockPrisma);
    await registerAuthRoutes(app);
  });

  afterEach(async () => {
    await app.close();
  });

  describe('POST /auth/signup', () => {
    it('creates a new user with valid email and password', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/signup',
        payload: { email: 'new@example.com', password: 'securepassword123' },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.userId).toBeDefined();
      expect(body.email).toBe('new@example.com');
    });

    it('rejects duplicate email', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'existing', email: 'existing@example.com', password: 'hash' });

      const response = await app.inject({
        method: 'POST',
        url: '/auth/signup',
        payload: { email: 'existing@example.com', password: 'securepassword123' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.message).toContain('Email already in use');
    });

    it('rejects invalid email format', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/signup',
        payload: { email: 'not-an-email', password: 'securepassword123' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('rejects password shorter than 8 characters', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/signup',
        payload: { email: 'test@example.com', password: 'short' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('rejects missing email', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/signup',
        payload: { password: 'securepassword123' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('rejects missing password', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/signup',
        payload: { email: 'test@example.com' },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('POST /auth/login', () => {
    it('returns an access token for valid credentials', async () => {
      const hashedPassword = 'hashed_password_123';
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 'user-1',
        email: 'user@example.com',
        password: hashedPassword,
      });

      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'user@example.com', password: 'correctpassword' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.accessToken).toBeDefined();
      expect(body.expiresIn).toBe('7d');
    });

    it('returns 401 for non-existent user', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);

      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'nobody@example.com', password: 'anypassword' },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.message).toContain('Invalid email or password');
    });

    it('returns 401 for wrong password', async () => {
      const hashedPassword = 'hashed_password_123';
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 'user-1',
        email: 'user@example.com',
        password: hashedPassword,
      });

      // Override bcrypt.compare to return false
      const bcrypt = await import('bcrypt');
      vi.mocked(bcrypt.default.compare).mockResolvedValueOnce(false);

      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'user@example.com', password: 'wrongpassword' },
      });

      expect(response.statusCode).toBe(401);
    });

    it('rejects invalid email format', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'not-an-email', password: 'anypassword' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('rejects missing email', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { password: 'anypassword' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('rejects missing password', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'user@example.com' },
      });

      expect(response.statusCode).toBe(400);
    });
  });
});