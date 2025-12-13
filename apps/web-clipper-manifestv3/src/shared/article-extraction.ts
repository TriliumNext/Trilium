/**
 * Main Article Extraction Module
 *
 * Provides unified article extraction functionality with optional code block preservation.
 * This module serves as the main entry point for extracting article content from web pages,
 * with intelligent decision-making about when to apply code preservation.
 *
 * @module articleExtraction
 *
 * ## Features
 *
 * - Unified extraction API for consistent results
 * - Conditional code block preservation based on settings
 * - Fast-path optimization for non-code pages
 * - Graceful fallbacks for error cases
 * - Comprehensive logging for debugging
 *
 * ## Usage
 *
 * ```typescript
 * import { extractArticle } from './article-extraction';
 *
 * // Simple usage (auto-detect code blocks)
 * const result = await extractArticle(document, window.location.href);
 *
 * // With explicit settings
 * const result = await extractArticle(document, url, {
 *   preserveCodeBlocks: true,
 *   autoDetect: true
 * });
 * ```
 */

import { Logger } from '@/shared/utils';
import { detectCodeBlocks } from '@/shared/code-block-detection';
import {
  extractWithCodeBlockPreservation,
  runVanillaReadability,
  ExtractionResult
} from '@/shared/readability-code-preservation';
import {
  loadCodeBlockSettings,
  saveCodeBlockSettings,
  shouldPreserveCodeForSite as shouldPreserveCodeForSiteCheck
} from '@/shared/code-block-settings';
import type { CodeBlockSettings } from '@/shared/code-block-settings';
import { Readability } from '@mozilla/readability';

const logger = Logger.create('ArticleExtraction', 'content');

/**
 * Settings for article extraction
 */
export interface ExtractionSettings {
  /** Enable code block preservation */
  preserveCodeBlocks?: boolean;
  /** Auto-detect if page contains code blocks */
  autoDetect?: boolean;
  /** Minimum number of code blocks to trigger preservation */
  minCodeBlocks?: number;
}

/**
 * Re-export AllowListEntry from code-block-settings for convenience
 */
export type { AllowListEntry } from '@/shared/code-block-settings';

/**
 * Default extraction settings
 */
const DEFAULT_SETTINGS: Required<ExtractionSettings> = {
  preserveCodeBlocks: true,
  autoDetect: true,
  minCodeBlocks: 1
};

/**
 * Extended extraction result with additional metadata
 */
export interface ArticleExtractionResult extends ExtractionResult {
  /** Whether code blocks were detected in the page */
  codeBlocksDetected?: boolean;
  /** Number of code blocks detected (before extraction) */
  codeBlocksDetectedCount?: number;
  /** Extraction method used */
  extractionMethod?: 'vanilla' | 'code-preservation';
  /** Error message if extraction failed */
  error?: string;
}

/**
 * Check if document contains code blocks (fast check)
 *
 * Performs a quick check for common code block patterns without
 * running full code block detection. This is used for fast-path optimization.
 *
 * @param document - Document to check
 * @returns True if code blocks are likely present
 */
function hasCodeBlocks(document: Document): boolean {
  try {
    if (!document || !document.body) {
      return false;
    }

    // Quick check for <pre> tags (always code blocks)
    const preCount = document.body.querySelectorAll('pre').length;
    if (preCount > 0) {
      logger.debug('Fast check: found <pre> tags', { count: preCount });
      return true;
    }

    // Quick check for <code> tags
    const codeCount = document.body.querySelectorAll('code').length;
    if (codeCount > 0) {
      // If we have code tags, do a slightly more expensive check
      // to see if any are likely block-level (not just inline code)
      const codeElements = document.body.querySelectorAll('code');
      for (const code of Array.from(codeElements)) {
        const text = code.textContent || '';
        // Quick heuristics for block-level code
        if (text.includes('\n') || text.length > 80) {
          logger.debug('Fast check: found block-level <code> tag');
          return true;
        }
      }
    }

    logger.debug('Fast check: no code blocks detected');
    return false;
  } catch (error) {
    logger.error('Error in fast code block check', error as Error);
    return false; // Assume no code blocks on error
  }
}

/**
 * Check if code preservation should be applied for this site
 *
 * Uses the code-block-settings module to check against the allow list
 * and global settings.
 *
 * @param url - URL of the page
 * @param settings - Extraction settings
 * @returns Promise resolving to true if preservation should be applied
 */
async function shouldPreserveCodeForSite(
  url: string,
  settings: ExtractionSettings
): Promise<boolean> {
  try {
    // If code block preservation is disabled globally, return false
    if (!settings.preserveCodeBlocks) {
      return false;
    }

    // Use the code-block-settings module to check
    // This will check auto-detect and allow list
    const shouldPreserve = await shouldPreserveCodeForSiteCheck(url);

    logger.debug('Site preservation check', { url, shouldPreserve });
    return shouldPreserve;
  } catch (error) {
    logger.error('Error checking if site should preserve code', error as Error);
    return settings.autoDetect || false; // Fall back to autoDetect
  }
}

/**
 * Extract article with intelligent code block preservation
 *
 * This is the main entry point for article extraction. It:
 * 1. Checks if code blocks are present (fast path optimization)
 * 2. Loads settings if not provided
 * 3. Determines if code preservation should be applied
 * 4. Runs appropriate extraction method (with or without preservation)
 * 5. Returns consistent result with metadata
 *
 * @param document - Document to extract from (will be cloned internally)
 * @param url - URL of the page (for settings/allow list)
 * @param settings - Optional extraction settings (will use defaults if not provided)
 * @returns Extraction result with metadata, or null if extraction fails
 *
 * @example
 * ```typescript
 * // Auto-detect code blocks and apply preservation if needed
 * const result = await extractArticle(document, window.location.href);
 *
 * // Force code preservation on
 * const result = await extractArticle(document, url, {
 *   preserveCodeBlocks: true,
 *   autoDetect: false
 * });
 *
 * // Force code preservation off
 * const result = await extractArticle(document, url, {
 *   preserveCodeBlocks: false
 * });
 * ```
 */
export async function extractArticle(
  document: Document,
  url: string,
  settings?: ExtractionSettings
): Promise<ArticleExtractionResult | null> {
  try {
    // Validate inputs
    if (!document || !document.body) {
      logger.error('Invalid document provided for extraction');
      return {
        title: '',
        byline: null,
        dir: null,
        content: '',
        textContent: '',
        length: 0,
        excerpt: null,
        siteName: null,
        error: 'Invalid document provided',
        extractionMethod: 'vanilla',
        preservationApplied: false,
        codeBlocksPreserved: 0,
        codeBlocksDetected: false,
        codeBlocksDetectedCount: 0
      };
    }

    // Use provided settings or defaults
    const opts = { ...DEFAULT_SETTINGS, ...settings };

    logger.info('Starting article extraction', {
      url,
      settings: opts,
      documentTitle: document.title
    });

    // Fast-path: Quick check for code blocks
    let hasCode = false;
    let codeBlockCount = 0;

    if (opts.autoDetect || opts.preserveCodeBlocks) {
      hasCode = hasCodeBlocks(document);

      // If fast check found code, get accurate count
      if (hasCode) {
        try {
          const detectedBlocks = detectCodeBlocks(document, {
            includeInline: false,
            minBlockLength: 80
          });
          codeBlockCount = detectedBlocks.length;
          logger.info('Code blocks detected', {
            count: codeBlockCount,
            hasEnoughBlocks: codeBlockCount >= opts.minCodeBlocks
          });
        } catch (error) {
          logger.error('Error detecting code blocks', error as Error);
          // Continue with fast check result
        }
      }
    }

    // Determine if we should apply code preservation
    let shouldPreserve = false;

    if (opts.preserveCodeBlocks) {
      if (opts.autoDetect) {
        // Auto-detect mode: only preserve if code blocks present and above threshold
        shouldPreserve = hasCode && codeBlockCount >= opts.minCodeBlocks;
      } else {
        // Manual mode: always preserve if enabled
        shouldPreserve = true;
      }

      // Check site-specific settings using code-block-settings module
      if (shouldPreserve) {
        shouldPreserve = await shouldPreserveCodeForSite(url, opts);
      }
    }

    logger.info('Preservation decision', {
      shouldPreserve,
      hasCode,
      codeBlockCount,
      preservationEnabled: opts.preserveCodeBlocks,
      autoDetect: opts.autoDetect
    });

    // Clone document to avoid modifying original
    const documentCopy = document.cloneNode(true) as Document;

    // Run appropriate extraction method
    let result: ExtractionResult | null;
    let extractionMethod: 'vanilla' | 'code-preservation';

    if (shouldPreserve) {
      logger.debug('Using code preservation extraction');
      extractionMethod = 'code-preservation';
      result = extractWithCodeBlockPreservation(documentCopy, Readability);
    } else {
      logger.debug('Using vanilla extraction (no code preservation needed)');
      extractionMethod = 'vanilla';
      result = runVanillaReadability(documentCopy, Readability);
    }

    // Handle extraction failure
    if (!result) {
      logger.error('Extraction failed (returned null)');
      return {
        title: document.title || '',
        byline: null,
        dir: null,
        content: document.body.innerHTML || '',
        textContent: document.body.textContent || '',
        length: document.body.textContent?.length || 0,
        excerpt: null,
        siteName: null,
        error: 'Readability extraction failed',
        extractionMethod,
        preservationApplied: false,
        codeBlocksPreserved: 0,
        codeBlocksDetected: hasCode,
        codeBlocksDetectedCount: codeBlockCount
      };
    }

    // Return enhanced result with metadata
    const enhancedResult: ArticleExtractionResult = {
      ...result,
      extractionMethod,
      codeBlocksDetected: hasCode,
      codeBlocksDetectedCount: codeBlockCount
    };

    logger.info('Article extraction complete', {
      title: enhancedResult.title,
      contentLength: enhancedResult.content.length,
      extractionMethod: enhancedResult.extractionMethod,
      preservationApplied: enhancedResult.preservationApplied,
      codeBlocksPreserved: enhancedResult.codeBlocksPreserved,
      codeBlocksDetected: enhancedResult.codeBlocksDetected,
      codeBlocksDetectedCount: enhancedResult.codeBlocksDetectedCount
    });

    return enhancedResult;
  } catch (error) {
    logger.error('Unexpected error during article extraction', error as Error);

    // Return error result with fallback content
    return {
      title: document.title || '',
      byline: null,
      dir: null,
      content: document.body?.innerHTML || '',
      textContent: document.body?.textContent || '',
      length: document.body?.textContent?.length || 0,
      excerpt: null,
      siteName: null,
      error: (error as Error).message,
      extractionMethod: 'vanilla',
      preservationApplied: false,
      codeBlocksPreserved: 0,
      codeBlocksDetected: false,
      codeBlocksDetectedCount: 0
    };
  }
}

/**
 * Extract article without code preservation (convenience function)
 *
 * This is a convenience wrapper that forces vanilla extraction.
 * Useful when you know you don't need code preservation.
 *
 * @param document - Document to extract from
 * @param url - URL of the page
 * @returns Extraction result, or null if extraction fails
 */
export async function extractArticleVanilla(
  document: Document,
  url: string
): Promise<ArticleExtractionResult | null> {
  return extractArticle(document, url, {
    preserveCodeBlocks: false,
    autoDetect: false
  });
}

/**
 * Extract article with forced code preservation (convenience function)
 *
 * This is a convenience wrapper that forces code preservation on.
 * Useful when you know the page contains code and want to preserve it.
 *
 * @param document - Document to extract from
 * @param url - URL of the page
 * @returns Extraction result, or null if extraction fails
 */
export async function extractArticleWithCode(
  document: Document,
  url: string
): Promise<ArticleExtractionResult | null> {
  return extractArticle(document, url, {
    preserveCodeBlocks: true,
    autoDetect: false
  });
}

/**
 * Load settings from Chrome storage
 *
 * Loads code block preservation settings from chrome.storage.sync.
 * Maps from CodeBlockSettings to ExtractionSettings format.
 *
 * @returns Promise resolving to extraction settings
 */
export async function loadExtractionSettings(): Promise<ExtractionSettings> {
  try {
    logger.debug('Loading extraction settings from storage');

    const codeBlockSettings = await loadCodeBlockSettings();

    // Map CodeBlockSettings to ExtractionSettings
    const extractionSettings: ExtractionSettings = {
      preserveCodeBlocks: codeBlockSettings.enabled,
      autoDetect: codeBlockSettings.autoDetect,
      minCodeBlocks: DEFAULT_SETTINGS.minCodeBlocks
    };

    logger.info('Extraction settings loaded', extractionSettings);
    return extractionSettings;
  } catch (error) {
    logger.error('Error loading extraction settings, using defaults', error as Error);
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Save settings to Chrome storage
 *
 * Saves extraction settings to chrome.storage.sync.
 * Updates only the enabled and autoDetect flags, preserving the allow list.
 *
 * @param settings - Settings to save
 */
export async function saveExtractionSettings(settings: ExtractionSettings): Promise<void> {
  try {
    logger.debug('Saving extraction settings to storage', settings);

    // Load current settings to preserve allow list
    const currentSettings = await loadCodeBlockSettings();

    // Update only the enabled and autoDetect flags
    const updatedSettings: CodeBlockSettings = {
      ...currentSettings,
      enabled: settings.preserveCodeBlocks ?? currentSettings.enabled,
      autoDetect: settings.autoDetect ?? currentSettings.autoDetect
    };

    await saveCodeBlockSettings(updatedSettings);
    logger.info('Extraction settings saved successfully');
  } catch (error) {
    logger.error('Error saving extraction settings', error as Error);
    throw error;
  }
}
