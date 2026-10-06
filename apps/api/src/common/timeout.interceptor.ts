import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  RequestTimeoutException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable, throwError, TimeoutError } from 'rxjs';
import { catchError, timeout } from 'rxjs/operators';

@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  private readonly timeout: number;

  constructor(private configService: ConfigService) {
    this.timeout = this.configService.get<number>('REQUEST_TIMEOUT', 120000);
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      timeout({ each: this.timeout }),
      catchError((err) => {
        if (err instanceof TimeoutError) {
          return throwError(
            () =>
              new RequestTimeoutException(
                `Request exceeded timeout of ${this.timeout}ms`,
              ),
          );
        }
        return throwError(() => err);
      }),
    );
  }
}
