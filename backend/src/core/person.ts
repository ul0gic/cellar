import type { FastifyRequest } from 'fastify';
import type { Person } from './access.ts';

export function personOf(request: Pick<FastifyRequest, 'person'>): Person {
  if (request.person === null) {
    throw new Error('a session route ran without a person');
  }
  return request.person;
}
