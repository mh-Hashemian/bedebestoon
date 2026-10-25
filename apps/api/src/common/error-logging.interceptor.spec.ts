import { CallHandler, ExecutionContext, Logger } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { ErrorLoggingInterceptor } from './error-logging.interceptor';

function ctx(): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ method: 'POST', url: '/expenses' }),
    }),
  } as unknown as ExecutionContext;
}

function handler<T>(value: T): CallHandler {
  return { handle: () => of(value) } as CallHandler;
}

describe('ErrorLoggingInterceptor', () => {
  it('passes successful responses through untouched', (done) => {
    new ErrorLoggingInterceptor()
      .intercept(ctx(), handler({ ok: true }))
      .subscribe({ next: (v) => expect(v).toEqual({ ok: true }), complete: done });
  });

  it('logs method, path, status and message, then rethrows the same error', (done) => {
    const spy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const err = Object.assign(new Error('boom'), {
      status: 400,
      getStatus: () => 400,
      getResponse: () => ({ message: 'boom', statusCode: 400 }),
    });
    new ErrorLoggingInterceptor()
      .intercept(ctx(), { handle: () => throwError(() => err) } as CallHandler)
      .subscribe({
        error: (e: unknown) => {
          expect(e).toBe(err);
          expect(spy).toHaveBeenCalledWith(
            expect.stringContaining('POST /expenses -> 400'),
          );
          expect(spy.mock.calls[0][0]).toContain('boom');
          spy.mockRestore();
          done();
        },
      });
  });
});
