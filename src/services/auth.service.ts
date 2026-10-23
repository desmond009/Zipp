import { hashPassword, verifyPassword } from '../domain/password.js';
import { ConflictError, UnauthorizedError } from '../errors.js';
import type { UserRepository } from '../repositories/user.repository.js';
import type { AuthUser } from './session-store.js';

export class AuthService {
  constructor(private readonly users: UserRepository) {}

  async register(email: string, password: string): Promise<AuthUser> {
    const user = await this.users.insert(normalizeEmail(email), await hashPassword(password));
    if (!user) {
      throw new ConflictError('An account with this email already exists');
    }
    return { id: user._id.toHexString(), email: user.email };
  }

  async login(email: string, password: string): Promise<AuthUser> {
    const user = await this.users.findByEmail(normalizeEmail(email));

    if (!user) {
      // Hash anyway so "no such user" takes as long as "wrong password".
      // Otherwise response time would reveal which emails have accounts.
      await hashPassword(password);
      throw new UnauthorizedError('Invalid email or password');
    }
    if (!(await verifyPassword(password, user.passwordHash))) {
      // Same message for both cases, for the same reason.
      throw new UnauthorizedError('Invalid email or password');
    }
    return { id: user._id.toHexString(), email: user.email };
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
