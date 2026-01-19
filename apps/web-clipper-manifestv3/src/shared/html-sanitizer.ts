/**
 * HTML Sanitization module using DOMPurify
 *
 * Implements the security recommendations from Mozilla Readability documentation
 * to sanitize HTML content and prevent script injection attacks.
 *
 * This is Phase 3 of the processing pipeline (after Readability and Cheerio).
 *
 * Note: This module should be used in contexts where the DOM is available (content scripts).
 * For background scripts, the sanitization happens in the content script before sending data.
 */

import DOMPurify from 'dompurify';
import type { Config } from 'dompurify';
import { Logger } from './utils';

const logger = Logger.create('HTMLSanitizer', 'content');

export interface SanitizeOptions {
  /**
   * Allow images in the sanitized HTML
   * @default true
   */
  allowImages?: boolean;

  /**
   * Allow external links in the sanitized HTML
   * @default true
   */
  allowLinks?: boolean;

  /**
   * Allow data URIs in image sources
   * @default true
   */
  allowDataUri?: boolean;

  /**
   * Custom allowed tags (extends defaults)
   */
  extraAllowedTags?: string[];

  /**
   * Custom allowed attributes (extends defaults)
   */
  extraAllowedAttrs?: string[];

  /**
   * Custom configuration for DOMPurify
   */
  customConfig?: Config;
}

/**
 * Default configuration for DOMPurify
 * Designed for Trilium note content (HTML notes and CKEditor compatibility)
 */
const DEFAULT_CONFIG: Config = {
  // Allow safe HTML tags commonly used in notes
  ALLOWED_TAGS: [
    // Text formatting
    'p', 'br', 'span', 'div',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'strong', 'em', 'b', 'i', 'u', 's', 'sub', 'sup',
    'mark', 'small', 'del', 'ins',

    // Lists
    'ul', 'ol', 'li',

    // Links and media
    'a', 'img', 'figure', 'figcaption',

    // Tables
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'col', 'colgroup',

    // Code
    'code', 'pre', 'kbd', 'samp', 'var',

    // Quotes and citations
    'blockquote', 'q', 'cite',

    // Structural
    'article', 'section', 'header', 'footer', 'main', 'aside', 'nav',
    'details', 'summary',

    // Definitions
    'dl', 'dt', 'dd',

    // Other
    'hr', 'time', 'abbr', 'address'
  ],

  // Allow safe attributes
  ALLOWED_ATTR: [
    'href', 'src', 'alt', 'title', 'class', 'id',
    'width', 'height', 'style',
    'target', 'rel',
    'colspan', 'rowspan',
    'datetime',
    'start', 'reversed', 'type',
    'data-*' // Allow data attributes for Trilium features
  ],

  // Allow data URIs for images (base64 encoded images)
  ALLOW_DATA_ATTR: true,

  // Allow safe URI schemes
  ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|cid|xmpp|data):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,

  // Keep safe HTML and remove dangerous content
  KEEP_CONTENT: true,

  // Return a DOM object instead of string (better for processing)
  RETURN_DOM: false,
  RETURN_DOM_FRAGMENT: false,

  // Force body context
  FORCE_BODY: false,

  // Sanitize in place
  IN_PLACE: false,

  // Safe for HTML context
  SAFE_FOR_TEMPLATES: true,

  // Allow style attributes (Trilium uses inline styles)
  ALLOW_UNKNOWN_PROTOCOLS: false,

  // Whole document mode
  WHOLE_DOCUMENT: false
};

/**
 * Sanitize HTML content using DOMPurify
 * This implements the security layer recommended by Mozilla Readability
 *
 * @param html - Raw HTML string to sanitize
 * @param options - Sanitization options
 * @returns Sanitized HTML string safe for insertion into Trilium
 */
export function sanitizeHtml(html: string, options: SanitizeOptions = {}): string {
  const {
    allowImages = true,
    allowLinks = true,
    allowDataUri = true,
    extraAllowedTags = [],
    extraAllowedAttrs = [],
    customConfig = {}
  } = options;

  try {
    // Build configuration
    const config: Config = {
      ...DEFAULT_CONFIG,
      ...customConfig
    };

    // Adjust allowed tags based on options
    if (!allowImages && config.ALLOWED_TAGS) {
      config.ALLOWED_TAGS = config.ALLOWED_TAGS.filter((tag: string) =>
        tag !== 'img' && tag !== 'figure' && tag !== 'figcaption'
      );
    }

    if (!allowLinks && config.ALLOWED_TAGS) {
      config.ALLOWED_TAGS = config.ALLOWED_TAGS.filter((tag: string) => tag !== 'a');
      if (config.ALLOWED_ATTR) {
        config.ALLOWED_ATTR = config.ALLOWED_ATTR.filter((attr: string) =>
          attr !== 'href' && attr !== 'target' && attr !== 'rel'
        );
      }
    }

    if (!allowDataUri) {
      config.ALLOW_DATA_ATTR = false;
    }

    // Add extra allowed tags
    if (extraAllowedTags.length > 0 && config.ALLOWED_TAGS) {
      config.ALLOWED_TAGS = [...config.ALLOWED_TAGS, ...extraAllowedTags];
    }

    // Add extra allowed attributes
    if (extraAllowedAttrs.length > 0 && config.ALLOWED_ATTR) {
      config.ALLOWED_ATTR = [...config.ALLOWED_ATTR, ...extraAllowedAttrs];
    }

    // Track what DOMPurify removes via hooks
    const removedElements: Array<{ tag: string; reason?: string }> = [];
    const removedAttributes: Array<{ element: string; attr: string }> = [];

    // Add hooks to track DOMPurify's actions
    DOMPurify.addHook('uponSanitizeElement', (_node, data) => {
      if (data.allowedTags && !data.allowedTags[data.tagName]) {
        removedElements.push({
          tag: data.tagName,
          reason: 'not in allowed tags'
        });
      }
    });

    DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
      if (data.attrName && data.keepAttr === false) {
        removedAttributes.push({
          element: node.nodeName.toLowerCase(),
          attr: data.attrName
        });
      }
    });

    // Sanitize the HTML using isomorphic-dompurify
    // Works in both browser and service worker contexts
    const cleanHtml = DOMPurify.sanitize(html, config) as string;

    // Remove hooks after sanitization
    DOMPurify.removeAllHooks();

    // Aggregate stats
    const tagCounts: Record<string, number> = {};
    removedElements.forEach(({ tag }) => {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    });

    const attrCounts: Record<string, number> = {};
    removedAttributes.forEach(({ attr }) => {
      attrCounts[attr] = (attrCounts[attr] || 0) + 1;
    });

    logger.debug('DOMPurify sanitization complete', {
      originalLength: html.length,
      cleanLength: cleanHtml.length,
      bytesRemoved: html.length - cleanHtml.length,
      reductionPercent: Math.round(((html.length - cleanHtml.length) / html.length) * 100),
      elementsRemoved: removedElements.length,
      attributesRemoved: removedAttributes.length,
      removedTags: Object.keys(tagCounts).length > 0 ? tagCounts : undefined,
      removedAttrs: Object.keys(attrCounts).length > 0 ? attrCounts : undefined,
      config: {
        allowImages,
        allowLinks,
        allowDataUri,
        extraAllowedTags: extraAllowedTags.length > 0 ? extraAllowedTags : undefined
      }
    });

    return cleanHtml;
  } catch (error) {
    logger.error('Failed to sanitize HTML', error as Error, {
      htmlLength: html.length,
      options
    });

    // Return empty string on error (fail safe)
    return '';
  }
}

/**
 * Quick sanitization for simple text content
 * Strips all HTML tags except basic formatting
 */
export function sanitizeSimpleText(html: string): string {
  return sanitizeHtml(html, {
    allowImages: false,
    allowLinks: true,
    customConfig: {
      ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'b', 'i', 'u', 'a', 'code', 'pre']
    }
  });
}

/**
 * Aggressive sanitization - strips almost everything
 * Use for untrusted or potentially dangerous content
 */
export function sanitizeAggressive(html: string): string {
  return sanitizeHtml(html, {
    allowImages: false,
    allowLinks: false,
    customConfig: {
      ALLOWED_TAGS: ['p', 'br', 'strong', 'em'],
      ALLOWED_ATTR: []
    }
  });
}

/**
 * Sanitize URLs to prevent javascript: and data: injection
 */
export function sanitizeUrl(url: string): string {
  const cleaned = DOMPurify.sanitize(url, {
    ALLOWED_TAGS: [],
    ALLOWED_ATTR: []
  }) as string;

  // Block dangerous protocols
  const dangerousProtocols = ['javascript:', 'data:', 'vbscript:', 'file:'];
  const lowerUrl = cleaned.toLowerCase().trim();

  for (const protocol of dangerousProtocols) {
    if (lowerUrl.startsWith(protocol)) {
      logger.warn('Blocked dangerous URL protocol', { url, protocol });
      return '#';
    }
  }

  return cleaned;
}export const HTMLSanitizer = {
  sanitize: sanitizeHtml,
  sanitizeSimpleText,
  sanitizeAggressive,
  sanitizeUrl
};
