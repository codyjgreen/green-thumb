import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcrypt';
import { badRequest, unauthorized } from '../lib/http-errors.js';

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export async function registerAuthRoutes(app: FastifyInstance) {
  app.post('/auth/signup', {
    schema: {
      description: 'Create a new account',
      tags: ['auth'],
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 8 },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            email: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { email, password } = signupSchema.parse(request.body);

    const existing = await app.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw badRequest('Email already in use');
    }

    const hashed = await bcrypt.hash(password, 10);
    const user = await app.prisma.user.create({
      data: { email, password: hashed },
      select: { id: true, email: true },
    });

    reply.code(201);
    return { userId: user.id, email: user.email };
  });

  app.post('/auth/login', {
    schema: {
      description: 'Log in and receive a JWT access token',
      tags: ['auth'],
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            accessToken: { type: 'string' },
            expiresIn: { type: 'string' },
          },
        },
      },
    },
  }, async (request, _reply) => {
    const { email, password } = loginSchema.parse(request.body);

    const user = await app.prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw unauthorized('Invalid email or password');
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      throw unauthorized('Invalid email or password');
    }

    const accessToken = app.jwt.sign({ userId: user.id, email: user.email });

    return {
      accessToken,
      expiresIn: '7d',
    };
  });
}
