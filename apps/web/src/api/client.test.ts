import { describe, expect, it } from 'vitest';
import { ApiError, friendlyError } from './client';

describe('friendlyError', () => {
  it('maps the remaining service validation messages instead of the generic text', () => {
    expect(friendlyError(new ApiError(400, 'In this phase a userId participant can only be yourself; add other people as contacts'))).toContain('فقط خودت');
    expect(friendlyError(new ApiError(400, 'Each participant must reference exactly one of userId or contactId'))).toContain('دقیقاً یک نفر');
  });
  it('maps class-validator fragments', () => {
    expect(friendlyError(new ApiError(400, 'totalAmount must be an integer'))).toContain('عدد صحیح');
    expect(friendlyError(new ApiError(400, 'totalAmount must not be less than 1'))).toContain('بیشتر از صفر');
  });
  it('keeps the generic text for bare proxy statuses', () => {
    expect(friendlyError(new ApiError(502, 'HTTP 502'))).toContain('سرور');
  });
});
