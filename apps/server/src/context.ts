import type { Actor } from '@cbt/core';
import type { FastifyRequest } from 'fastify';
import { forbidden, unauthorized } from './errors';
import { toActor } from './repo';
import type { AuthState } from './sessions';

export function requireAuth(req: FastifyRequest): AuthState {
  if (!req.auth) throw unauthorized();
  return req.auth;
}

/** The actor whose permissions apply (the viewed user while viewing as someone). */
export function actorOf(auth: AuthState): Actor {
  return toActor(auth.user);
}

/** Admin actions that must use the signed-in person's own rights, e.g. leaving view-as. */
export function requireRealAdmin(auth: AuthState): void {
  if (!auth.realUser.is_admin) throw forbidden('Admins only.');
}

export function requireAdmin(auth: AuthState): void {
  if (!auth.user.is_admin) throw forbidden('Admins only.');
}
