import { Logger } from './utils';
import { DateTimeFormatPreset } from './types';

const logger = Logger.create('DateFormatter');

/**
 * Date/Time format presets with examples
 */
export const DATE_TIME_PRESETS: DateTimeFormatPreset[] = [
  {
    id: 'iso',
    name: 'ISO 8601 (YYYY-MM-DD)',
    format: 'YYYY-MM-DD',
    example: '2025-11-08'
  },
  {
    id: 'iso-time',
    name: 'ISO with Time (YYYY-MM-DD HH:mm:ss)',
    format: 'YYYY-MM-DD HH:mm:ss',
    example: '2025-11-08 14:30:45'
  },
  {
    id: 'us',
    name: 'US Format (MM/DD/YYYY)',
    format: 'MM/DD/YYYY',
    example: '11/08/2025'
  },
  {
    id: 'us-time',
    name: 'US with Time (MM/DD/YYYY hh:mm A)',
    format: 'MM/DD/YYYY hh:mm A',
    example: '11/08/2025 02:30 PM'
  },
  {
    id: 'eu',
    name: 'European (DD/MM/YYYY)',
    format: 'DD/MM/YYYY',
    example: '08/11/2025'
  },
  {
    id: 'eu-time',
    name: 'European with Time (DD/MM/YYYY HH:mm)',
    format: 'DD/MM/YYYY HH:mm',
    example: '08/11/2025 14:30'
  },
  {
    id: 'long',
    name: 'Long Format (MMMM DD, YYYY)',
    format: 'MMMM DD, YYYY',
    example: 'November 08, 2025'
  },
  {
    id: 'long-time',
    name: 'Long with Time (MMMM DD, YYYY at HH:mm)',
    format: 'MMMM DD, YYYY at HH:mm',
    example: 'November 08, 2025 at 14:30'
  },
  {
    id: 'short',
    name: 'Short Format (MMM DD, YYYY)',
    format: 'MMM DD, YYYY',
    example: 'Nov 08, 2025'
  },
  {
    id: 'timestamp',
    name: 'Unix Timestamp',
    format: 'X',
    example: '1731081045'
  },
  {
    id: 'relative',
    name: 'Relative (e.g., "2 days ago")',
    format: 'relative',
    example: '2 days ago'
  }
];

/**
 * Month names for formatting
 */
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const MONTH_NAMES_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

/**
 * DateFormatter utility class
 * Handles date formatting with support for presets and custom formats
 */
export class DateFormatter {
  /**
   * Format a date using a format string
   * Supports common date format tokens
   */
  static format(date: Date, formatString: string): string {
    try {
      // Handle relative format specially
      if (formatString === 'relative') {
        return this.formatRelative(date);
      }

      // Handle Unix timestamp
      if (formatString === 'X') {
        return Math.floor(date.getTime() / 1000).toString();
      }

      // Get date components
      const year = date.getFullYear();
      const month = date.getMonth() + 1;
      const day = date.getDate();
      const hours = date.getHours();
      const minutes = date.getMinutes();
      const seconds = date.getSeconds();

      // Format tokens
      const tokens: Record<string, string> = {
        'YYYY': year.toString(),
        'YY': year.toString().slice(-2),
        'MMMM': MONTH_NAMES[date.getMonth()],
        'MMM': MONTH_NAMES_SHORT[date.getMonth()],
        'MM': month.toString().padStart(2, '0'),
        'M': month.toString(),
        'DD': day.toString().padStart(2, '0'),
        'D': day.toString(),
        'HH': hours.toString().padStart(2, '0'),
        'H': hours.toString(),
        'hh': (hours % 12 || 12).toString().padStart(2, '0'),
        'h': (hours % 12 || 12).toString(),
        'mm': minutes.toString().padStart(2, '0'),
        'm': minutes.toString(),
        'ss': seconds.toString().padStart(2, '0'),
        's': seconds.toString(),
        'A': hours >= 12 ? 'PM' : 'AM',
        'a': hours >= 12 ? 'pm' : 'am'
      };

      // Replace tokens in format string
      let result = formatString;

      // Sort tokens by length (descending) to avoid partial replacements
      const sortedTokens = Object.keys(tokens).sort((a, b) => b.length - a.length);

      for (const token of sortedTokens) {
        result = result.replace(new RegExp(token, 'g'), tokens[token]);
      }

      return result;
    } catch (error) {
      logger.error('Failed to format date', error as Error, { formatString });
      return date.toISOString().substring(0, 10); // Fallback to ISO date
    }
  }

  /**
   * Format a date as relative time (e.g., "2 days ago")
   */
  static formatRelative(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);
    const diffMonths = Math.floor(diffDays / 30);
    const diffYears = Math.floor(diffDays / 365);

    if (diffSeconds < 60) {
      return 'just now';
    } else if (diffMinutes < 60) {
      return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;
    } else if (diffHours < 24) {
      return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
    } else if (diffDays < 30) {
      return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
    } else if (diffMonths < 12) {
      return `${diffMonths} month${diffMonths === 1 ? '' : 's'} ago`;
    } else {
      return `${diffYears} year${diffYears === 1 ? '' : 's'} ago`;
    }
  }

  /**
   * Get user's configured date format from settings
   */
  static async getUserFormat(): Promise<string> {
    try {
      const settings = await chrome.storage.sync.get([
        'dateTimeFormat',
        'dateTimePreset',
        'dateTimeCustomFormat'
      ]);

      const formatType = settings.dateTimeFormat || 'preset';

      if (formatType === 'custom' && settings.dateTimeCustomFormat) {
        return settings.dateTimeCustomFormat;
      }

      // Use preset format
      const presetId = settings.dateTimePreset || 'iso';
      const preset = DATE_TIME_PRESETS.find(p => p.id === presetId);

      return preset?.format || 'YYYY-MM-DD';
    } catch (error) {
      logger.error('Failed to get user format', error as Error);
      return 'YYYY-MM-DD'; // Fallback
    }
  }

  /**
   * Format a date using user's configured format
   */
  static async formatWithUserSettings(date: Date): Promise<string> {
    const formatString = await this.getUserFormat();
    return this.format(date, formatString);
  }

  /**
   * Extract dates from document metadata (meta tags, JSON-LD, etc.)
   * Returns both published and modified dates if available
   */
  static extractDatesFromDocument(doc: Document = document): {
    publishedDate?: Date;
    modifiedDate?: Date;
  } {
    const dates: { publishedDate?: Date; modifiedDate?: Date } = {};

    try {
      // Try Open Graph meta tags first
      const publishedMeta = doc.querySelector("meta[property='article:published_time']");
      if (publishedMeta) {
        const publishedContent = publishedMeta.getAttribute('content');
        if (publishedContent) {
          dates.publishedDate = new Date(publishedContent);
        }
      }

      const modifiedMeta = doc.querySelector("meta[property='article:modified_time']");
      if (modifiedMeta) {
        const modifiedContent = modifiedMeta.getAttribute('content');
        if (modifiedContent) {
          dates.modifiedDate = new Date(modifiedContent);
        }
      }

      // Try other meta tags if OG tags not found
      if (!dates.publishedDate) {
        const altPublishedSelectors = [
          "meta[name='publishdate']",
          "meta[name='date']",
          "meta[property='og:published_time']",
          "meta[name='DC.date']",
          "meta[itemprop='datePublished']"
        ];

        for (const selector of altPublishedSelectors) {
          const element = doc.querySelector(selector);
          if (element) {
            const content = element.getAttribute('content') || element.getAttribute('datetime');
            if (content) {
              try {
                dates.publishedDate = new Date(content);
                break;
              } catch {
                continue;
              }
            }
          }
        }
      }

      if (!dates.modifiedDate) {
        const altModifiedSelectors = [
          "meta[name='last-modified']",
          "meta[property='og:updated_time']",
          "meta[name='DC.date.modified']",
          "meta[itemprop='dateModified']"
        ];

        for (const selector of altModifiedSelectors) {
          const element = doc.querySelector(selector);
          if (element) {
            const content = element.getAttribute('content') || element.getAttribute('datetime');
            if (content) {
              try {
                dates.modifiedDate = new Date(content);
                break;
              } catch {
                continue;
              }
            }
          }
        }
      }

      // Try JSON-LD structured data
      if (!dates.publishedDate || !dates.modifiedDate) {
        const jsonLdDates = this.extractDatesFromJsonLd(doc);
        if (jsonLdDates.publishedDate && !dates.publishedDate) {
          dates.publishedDate = jsonLdDates.publishedDate;
        }
        if (jsonLdDates.modifiedDate && !dates.modifiedDate) {
          dates.modifiedDate = jsonLdDates.modifiedDate;
        }
      }

      // Try time elements if still no dates
      if (!dates.publishedDate) {
        const timeElements = doc.querySelectorAll('time[datetime], time[pubdate]');
        for (const timeEl of Array.from(timeElements)) {
          const datetime = timeEl.getAttribute('datetime');
          if (datetime) {
            try {
              dates.publishedDate = new Date(datetime);
              break;
            } catch {
              continue;
            }
          }
        }
      }

      // Validate dates
      if (dates.publishedDate && isNaN(dates.publishedDate.getTime())) {
        logger.warn('Invalid published date extracted', { date: dates.publishedDate });
        delete dates.publishedDate;
      }
      if (dates.modifiedDate && isNaN(dates.modifiedDate.getTime())) {
        logger.warn('Invalid modified date extracted', { date: dates.modifiedDate });
        delete dates.modifiedDate;
      }

      logger.debug('Extracted dates from document', {
        publishedDate: dates.publishedDate?.toISOString(),
        modifiedDate: dates.modifiedDate?.toISOString()
      });

      return dates;
    } catch (error) {
      logger.error('Failed to extract dates from document', error as Error);
      return {};
    }
  }

  /**
   * Extract dates from JSON-LD structured data
   */
  private static extractDatesFromJsonLd(doc: Document = document): {
    publishedDate?: Date;
    modifiedDate?: Date;
  } {
    const dates: { publishedDate?: Date; modifiedDate?: Date } = {};

    try {
      const jsonLdScripts = doc.querySelectorAll('script[type="application/ld+json"]');

      for (const script of Array.from(jsonLdScripts)) {
        try {
          const data = JSON.parse(script.textContent || '{}');

          // Handle both single objects and arrays
          const items = Array.isArray(data) ? data : [data];

          for (const item of items) {
            // Look for Article, NewsArticle, BlogPosting, etc.
            if (item['@type'] && typeof item['@type'] === 'string' &&
                (item['@type'].includes('Article') || item['@type'].includes('Posting'))) {

              if (item.datePublished && !dates.publishedDate) {
                try {
                  dates.publishedDate = new Date(item.datePublished);
                } catch {
                  // Invalid date, continue
                }
              }

              if (item.dateModified && !dates.modifiedDate) {
                try {
                  dates.modifiedDate = new Date(item.dateModified);
                } catch {
                  // Invalid date, continue
                }
              }
            }
          }
        } catch (error) {
          // Invalid JSON, continue to next script
          logger.debug('Failed to parse JSON-LD script', { error });
          continue;
        }
      }

      return dates;
    } catch (error) {
      logger.error('Failed to extract dates from JSON-LD', error as Error);
      return {};
    }
  }

  /**
   * Generate example output for a given format string
   */
  static getFormatExample(formatString: string, date: Date = new Date()): string {
    return this.format(date, formatString);
  }

  /**
   * Validate a custom format string
   */
  static isValidFormat(formatString: string): boolean {
    try {
      // Try to format a test date
      const testDate = new Date('2025-11-08T14:30:45');
      this.format(testDate, formatString);
      return true;
    } catch {
      return false;
    }
  }
}
