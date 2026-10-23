import { User } from '@prisma/client';
import { toMeResponse } from './me.controller';

describe('toMeResponse (GET /me)', () => {
  it('exposes safe fields and serializes telegramId (BigInt) as a string', () => {
    const user = {
      id: 'u1',
      telegramId: BigInt(123456789),
      username: 'mohammad',
      firstName: 'Mohammad',
      lastName: null,
      phone: '+989120000000',
    } as User;

    expect(toMeResponse(user)).toEqual({
      id: 'u1',
      telegramId: '123456789',
      username: 'mohammad',
      firstName: 'Mohammad',
      lastName: null,
      phone: '+989120000000',
    });
    // Must not throw on JSON serialization (raw BigInt would).
    expect(() => JSON.stringify(toMeResponse(user))).not.toThrow();
  });

  it('keeps phone null when the user has not shared a number yet', () => {
    const user = {
      id: 'u2',
      telegramId: BigInt(42),
      username: null,
      firstName: 'Ali',
      lastName: 'Rezaei',
      phone: null,
    } as User;

    expect(toMeResponse(user).phone).toBeNull();
  });
});
