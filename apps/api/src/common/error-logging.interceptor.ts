import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';

/**
 * Logs every failed HTTP request (method, path, status, message) to stdout,
 * so the hosting logs show the real reason for a failure instead of only
 * startup lines. Render's request logs are disabled for this service, and
 * Nest does not log handled 4xx errors by itself — that combination made a
 * user's "server error" undiagnosable from the logs alone.
 *
 * The error is rethrown untouched: responses are byte-identical to before.
 */
@Injectable()
export class ErrorLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ErrorLoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context
      .switchToHttp()
      .getRequest<{ method: string; url: string }>();
    return next.handle().pipe(
      catchError((err: unknown) => {
        const status =
          (err as { status?: number })?.status ??
          (typeof (err as { getStatus?: unknown })?.getStatus === 'function'
            ? (err as { getStatus: () => number }).getStatus()
            : 500);
        const response =
          typeof (err as { getResponse?: unknown })?.getResponse === 'function'
            ? (err as { getResponse: () => unknown }).getResponse()
            : undefined;
        const detail =
          response !== undefined
            ? typeof response === 'string'
              ? response
              : JSON.stringify(response)
            : err instanceof Error
              ? err.message
              : String(err);
        this.logger.error(`${req.method} ${req.url} -> ${status} ${detail}`);
        return throwError(() => err);
      }),
    );
  }
}
