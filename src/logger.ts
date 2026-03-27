import {
  Logger,
  setLoggerFactory,
  type ILogger,
  type LogLevel,
  type LoggerOptions,
} from '@hashgraphonline/standards-sdk';
import { config } from './config';

class StderrLogger implements ILogger {
  private level: LogLevel;
  private moduleName: string;
  private silent: boolean;

  constructor(options: LoggerOptions = {}) {
    this.level = options.silent ? 'silent' : options.level ?? 'info';
    this.moduleName = options.module ?? 'registry-broker-codex-plugin';
    this.silent = options.silent ?? false;
  }

  debug(...args: unknown[]): void {
    this.write('debug', args);
  }

  info(...args: unknown[]): void {
    this.write('info', args);
  }

  warn(...args: unknown[]): void {
    this.write('warn', args);
  }

  error(...args: unknown[]): void {
    this.write('error', args);
  }

  trace(...args: unknown[]): void {
    this.write('trace', args);
  }

  setLogLevel(level: LogLevel): void {
    this.level = level;
  }

  getLevel(): LogLevel {
    return this.level;
  }

  setSilent(silent: boolean): void {
    this.silent = silent;
    if (silent) {
      this.level = 'silent';
    }
  }

  setModule(module: string): void {
    this.moduleName = module;
  }

  private write(level: LogLevel, args: unknown[]): void {
    if (this.silent || this.level === 'silent' || !shouldLog(this.level, level)) {
      return;
    }

    const record = {
      timestamp: new Date().toISOString(),
      level,
      module: this.moduleName,
      args,
    };
    process.stderr.write(`${JSON.stringify(record)}\n`);
  }
}

function shouldLog(current: LogLevel, target: LogLevel): boolean {
  const order: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'silent'];
  return order.indexOf(target) >= order.indexOf(current);
}

setLoggerFactory((options: LoggerOptions) => new StderrLogger(options));

export const logger = Logger.getInstance({
  level: config.logLevel,
  module: 'registry-broker-codex-plugin',
  prettyPrint: false,
});
