/**
 * Log entry interface for centralized logging
 */
export interface LogEntry {
  id: string;
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  context: string;
  message: string;
  args?: unknown[];
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
  source: 'background' | 'content' | 'popup' | 'options';
}

/**
 * Centralized logging system for the extension
 * Aggregates logs from all contexts and provides unified access
 */
export class CentralizedLogger {
  private static readonly MAX_LOGS = 1000;
  private static readonly STORAGE_KEY = 'extension_logs';

  /**
   * Add a log entry to centralized storage
   */
  static async addLog(entry: Omit<LogEntry, 'id' | 'timestamp'>): Promise<void> {
    try {
      const logEntry: LogEntry = {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        ...entry,
      };

      // Get existing logs
      const result = await chrome.storage.local.get(this.STORAGE_KEY);
      const logs: LogEntry[] = result[this.STORAGE_KEY] || [];

      // Add new log and maintain size limit
      logs.push(logEntry);
      if (logs.length > this.MAX_LOGS) {
        logs.splice(0, logs.length - this.MAX_LOGS);
      }

      // Store updated logs
      await chrome.storage.local.set({ [this.STORAGE_KEY]: logs });
    } catch (error) {
      console.error('Failed to store centralized log:', error);
    }
  }

  /**
   * Get all logs from centralized storage
   */
  static async getLogs(): Promise<LogEntry[]> {
    try {
      const result = await chrome.storage.local.get(this.STORAGE_KEY);
      return result[this.STORAGE_KEY] || [];
    } catch (error) {
      console.error('Failed to retrieve logs:', error);
      return [];
    }
  }

  /**
   * Clear all logs
   */
  static async clearLogs(): Promise<void> {
    try {
      await chrome.storage.local.remove(this.STORAGE_KEY);
    } catch (error) {
      console.error('Failed to clear logs:', error);
    }
  }

  /**
   * Export logs as JSON string
   */
  static async exportLogs(): Promise<string> {
    const logs = await this.getLogs();
    return JSON.stringify(logs, null, 2);
  }

  /**
   * Get logs filtered by level
   */
  static async getLogsByLevel(level: LogEntry['level']): Promise<LogEntry[]> {
    const logs = await this.getLogs();
    return logs.filter(log => log.level === level);
  }

  /**
   * Get logs filtered by context
   */
  static async getLogsByContext(context: string): Promise<LogEntry[]> {
    const logs = await this.getLogs();
    return logs.filter(log => log.context === context);
  }

  /**
   * Get logs filtered by source
   */
  static async getLogsBySource(source: LogEntry['source']): Promise<LogEntry[]> {
    const logs = await this.getLogs();
    return logs.filter(log => log.source === source);
  }
}

/**
 * Enhanced logging system for the extension with centralized storage
 */
export class Logger {
  private context: string;
  private source: LogEntry['source'];
  private isDebugMode: boolean = process.env.NODE_ENV === 'development';

  constructor(context: string, source: LogEntry['source'] = 'background') {
    this.context = context;
    this.source = source;
  }

  static create(context: string, source: LogEntry['source'] = 'background'): Logger {
    return new Logger(context, source);
  }

  private async logToStorage(level: LogEntry['level'], message: string, args?: unknown[], error?: Error): Promise<void> {
    const logEntry: Omit<LogEntry, 'id' | 'timestamp'> = {
      level,
      context: this.context,
      message,
      source: this.source,
      args: args && args.length > 0 ? args : undefined,
      error: error ? {
        name: error.name,
        message: error.message,
        stack: error.stack,
      } : undefined,
    };

    await CentralizedLogger.addLog(logEntry);
  }

  private formatMessage(level: string, message: string, ...args: unknown[]): void {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${this.source}:${this.context}] [${level.toUpperCase()}]`;

    if (this.isDebugMode || level === 'ERROR') {
      const consoleMethod = console[level as keyof typeof console] as (...args: unknown[]) => void;
      if (typeof consoleMethod === 'function') {
        consoleMethod(prefix, message, ...args);
      }
    }
  }

  debug(message: string, ...args: unknown[]): void {
    this.formatMessage('debug', message, ...args);
    this.logToStorage('debug', message, args).catch(console.error);
  }

  info(message: string, ...args: unknown[]): void {
    this.formatMessage('info', message, ...args);
    this.logToStorage('info', message, args).catch(console.error);
  }

  warn(message: string, ...args: unknown[]): void {
    this.formatMessage('warn', message, ...args);
    this.logToStorage('warn', message, args).catch(console.error);
  }

  error(message: string, error?: Error, ...args: unknown[]): void {
    this.formatMessage('error', message, error, ...args);
    this.logToStorage('error', message, args, error).catch(console.error);

    // In production, you might want to send errors to a logging service
    if (!this.isDebugMode && error) {
      this.reportError(error, message);
    }
  }

  private async reportError(error: Error, context: string): Promise<void> {
    try {
      // Store error details for debugging
      await chrome.storage.local.set({
        [`error_${Date.now()}`]: {
          message: error.message,
          stack: error.stack,
          context,
          timestamp: new Date().toISOString()
        }
      });
    } catch (e) {
      console.error('Failed to store error:', e);
    }
  }
}

/**
 * Utility functions
 */
export const Utils = {
  /**
   * Generate a random string of specified length
   */
  randomString(length: number): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  },

  /**
   * Get the base URL of the current page
   */
  getBaseUrl(url: string = window.location.href): string {
    try {
      const urlObj = new URL(url);
      return `${urlObj.protocol}//${urlObj.host}`;
    } catch (error) {
      return '';
    }
  },

  /**
   * Convert a relative URL to absolute
   */
  makeAbsoluteUrl(relativeUrl: string, baseUrl: string): string {
    try {
      return new URL(relativeUrl, baseUrl).href;
    } catch (error) {
      return relativeUrl;
    }
  },

  /**
   * Sanitize HTML content
   */
  sanitizeHtml(html: string): string {
    const div = document.createElement('div');
    div.textContent = html;
    return div.innerHTML;
  },

  /**
   * Debounce function calls
   */
  debounce<T extends (...args: unknown[]) => void>(
    func: T,
    wait: number
  ): (...args: Parameters<T>) => void {
    let timeout: NodeJS.Timeout;
    return (...args: Parameters<T>) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => func(...args), wait);
    };
  },

  /**
   * Sleep for specified milliseconds
   */
  sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  },

  /**
   * Retry a function with exponential backoff
   */
  async retry<T>(
    fn: () => Promise<T>,
    maxAttempts: number = 3,
    baseDelay: number = 1000
  ): Promise<T> {
    let lastError: Error;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;

        if (attempt === maxAttempts) {
          throw lastError;
        }

        const delay = baseDelay * Math.pow(2, attempt - 1);
        await this.sleep(delay);
      }
    }

    throw lastError!;
  }
};

/**
 * Browser detection utilities
 */
export type BrowserType = 'chrome' | 'firefox' | 'edge' | 'opera' | 'brave' | 'unknown';

export const BrowserDetect = {
  /**
   * Detect the current browser type
   */
  getBrowser(): BrowserType {
    const userAgent = navigator.userAgent.toLowerCase();

    // Order matters - check more specific browsers first
    if (userAgent.includes('edg/') || userAgent.includes('edge')) {
      return 'edge';
    }
    if (userAgent.includes('brave')) {
      return 'brave';
    }
    if (userAgent.includes('opr/') || userAgent.includes('opera')) {
      return 'opera';
    }
    if (userAgent.includes('firefox')) {
      return 'firefox';
    }
    if (userAgent.includes('chrome')) {
      return 'chrome';
    }

    return 'unknown';
  },

  /**
   * Check if running in Firefox
   */
  isFirefox(): boolean {
    return this.getBrowser() === 'firefox';
  },

  /**
   * Check if running in a Chromium-based browser
   */
  isChromium(): boolean {
    const browser = this.getBrowser();
    return ['chrome', 'edge', 'opera', 'brave'].includes(browser);
  },

  /**
   * Get the browser's extension shortcuts URL
   */
  getShortcutsUrl(): string | null {
    const browser = this.getBrowser();

    switch (browser) {
      case 'chrome':
        return 'chrome://extensions/shortcuts';
      case 'edge':
        return 'edge://extensions/shortcuts';
      case 'opera':
        return 'opera://extensions/shortcuts';
      case 'brave':
        return 'brave://extensions/shortcuts';
      case 'firefox':
        // Firefox doesn't allow opening about: URLs programmatically
        return null;
      default:
        return null;
    }
  },

  /**
   * Get human-readable browser name
   */
  getBrowserName(): string {
    const browser = this.getBrowser();
    const names: Record<BrowserType, string> = {
      chrome: 'Chrome',
      firefox: 'Firefox',
      edge: 'Edge',
      opera: 'Opera',
      brave: 'Brave',
      unknown: 'your browser'
    };
    return names[browser];
  },

  /**
   * Get instructions for accessing shortcuts in the current browser
   */
  getShortcutsInstructions(): string {
    const browser = this.getBrowser();

    switch (browser) {
      case 'firefox':
        return 'In Firefox: Menu (☰) → Add-ons and themes → Extensions (⚙️ gear icon) → Manage Extension Shortcuts';
      case 'edge':
        return 'Opens Edge extension shortcuts settings';
      case 'opera':
        return 'Opens Opera extension shortcuts settings';
      case 'brave':
        return 'Opens Brave extension shortcuts settings';
      case 'chrome':
      default:
        return 'Opens Chrome extension shortcuts settings';
    }
  }
};

/**
 * Message handling utilities
 */
export const MessageUtils = {
  /**
   * Send a message with automatic retry and error handling
   */
  async sendMessage<T>(message: unknown, tabId?: number): Promise<T> {
    const logger = Logger.create('MessageUtils');

    try {
      const response = tabId
        ? await chrome.tabs.sendMessage(tabId, message)
        : await chrome.runtime.sendMessage(message);

      return response as T;
    } catch (error) {
      logger.error('Failed to send message', error as Error, { message, tabId });
      throw error;
    }
  },

  /**
   * Create a message response handler
   */
  createResponseHandler<T>(
    handler: (message: unknown, sender: chrome.runtime.MessageSender) => Promise<T> | T,
    source: LogEntry['source'] = 'background'
  ) {
    return (
      message: unknown,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: T) => void
    ): boolean => {
      const logger = Logger.create('MessageHandler', source);

      Promise.resolve(handler(message, sender))
        .then(sendResponse)
        .catch(error => {
          logger.error('Message handler failed', error as Error, { message, sender });
          sendResponse({ error: error.message } as T);
        });

      return true; // Indicates async response
    };
  }
};
