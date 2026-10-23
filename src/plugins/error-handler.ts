import type { FastifyError, FastifyInstance } from 'fastify';
import { AppError } from '../errors.js';

/**
 * One place that turns errors into HTTP responses, so every route returns the
 * same shape: { error: { code, message } }.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    // Errors we threw on purpose (404, 409, 410, ...).
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message } });
    }

    // Request failed Fastify's JSON schema validation.
    if (error.validation) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: error.message } });
    }

    // Other client errors raised by Fastify itself (malformed JSON, body too large, ...).
    if (error.statusCode && error.statusCode < 500) {
      return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message } });
    }

    // Anything else is a bug or an infrastructure failure: log it in full, but
    // don't leak internal details to the client.
    request.log.error({ err: error }, 'Unhandled error');
    return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  });

  app.setNotFoundHandler((_request, reply) => {
    return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Not found' } });
  });
}
