/**
 * Readability Monkey-Patch Module
 *
 * This module provides functionality to preserve code blocks during Mozilla Readability extraction.
 * It works by monkey-patching Readability's cleaning methods to skip elements marked for preservation.
 *
 * @module readabilityCodePreservation
 *
 * ## Implementation Approach
 *
 * Readability's cleaning methods (_clean, _removeNodes, _cleanConditionally) aggressively remove
 * elements that don't appear to be core article content. This includes code blocks, which are often
 * removed or relocated incorrectly.
 *
 * Our solution:
 * 1. Mark code blocks with a preservation attribute before Readability runs
 * 2. Monkey-patch Readability's internal methods to skip marked elements
 * 3. Run Readability extraction with protections in place
 * 4. Clean up markers from the output
 * 5. Always restore original methods (using try-finally for safety)
 *
 * ## Brittleness Considerations
 *
 * This approach directly modifies Readability's prototype methods, which has some risks:
 * - Readability updates could change method signatures or names
 * - Other extensions modifying Readability could conflict
 * - Method existence checks provide some safety
 * - Always restoring original methods prevents permanent changes
 *
 * ## Testing
 *
 * - Verify code blocks remain in correct positions
 * - Test with various code block structures (pre, code, pre>code)
 * - Ensure original methods are always restored (even on errors)
 * - Test fallback behavior if monkey-patching fails
 */

import { Logger } from './utils';
import { detectCodeBlocks } from './code-block-detection';
import type { Readability } from '@mozilla/readability';

const logger = Logger.create('ReadabilityCodePreservation', 'content');

/**
 * Marker attribute used to identify preserved elements
 * Using 'data-readability-preserve-code' to stay within the readability namespace
 */
const PRESERVE_MARKER = 'data-readability-preserve-code';

/**
 * Result from extraction with code block preservation
 */
export interface ExtractionResult {
  /** Article title */
  title: string;
  /** Article byline/author */
  byline: string | null;
  /** Text direction (ltr, rtl) */
  dir: string | null;
  /** Extracted HTML content */
  content: string;
  /** Plain text content */
  textContent: string;
  /** Content length */
  length: number;
  /** Article excerpt/summary */
  excerpt: string | null;
  /** Site name */
  siteName: string | null;
  /** Number of code blocks preserved */
  codeBlocksPreserved?: number;
  /** Whether preservation was applied */
  preservationApplied?: boolean;
}

/**
 * Stored original Readability methods for restoration
 */
interface OriginalMethods {
  _clean?: Function;
  _removeNodes?: Function;
  _cleanConditionally?: Function;
}

/**
 * Check if an element or its descendants have the preservation marker
 *
 * @param element - Element to check
 * @returns True if element should be preserved
 */
function shouldPreserveElement(element: Element): boolean {
  if (!element) return false;

  // Check if element itself is marked
  if (element.hasAttribute && element.hasAttribute(PRESERVE_MARKER)) {
    return true;
  }

  // Check if element contains preserved descendants
  if (element.querySelector && element.querySelector(`[${PRESERVE_MARKER}]`)) {
    return true;
  }

  return false;
}

/**
 * Mark code blocks in document for preservation
 *
 * @param document - Document to mark code blocks in
 * @returns Array of marked code block elements
 */
function markCodeBlocksForPreservation(document: Document): Element[] {
  const markedBlocks: Element[] = [];

  try {
    if (!document || !document.body) {
      logger.warn('Invalid document provided for code block marking');
      return markedBlocks;
    }

    // Mark all <pre> tags (always block-level)
    const preElements = document.body.querySelectorAll('pre');
    logger.debug(`Found ${preElements.length} <pre> elements to mark`);

    preElements.forEach(block => {
      block.setAttribute(PRESERVE_MARKER, 'true');
      markedBlocks.push(block);
    });

    // Detect and mark block-level <code> tags using our detection module
    const codeBlocks = detectCodeBlocks(document, {
      includeInline: false, // Only block-level code
      minBlockLength: 80
    });

    logger.debug(`Code block detection found ${codeBlocks.length} block-level code elements`);

    codeBlocks.forEach(blockMetadata => {
      const block = blockMetadata.element;
      // Skip if already inside a <pre> (already marked)
      if (block.closest('pre')) return;

      // Only mark block-level code
      if (blockMetadata.isBlockLevel) {
        block.setAttribute(PRESERVE_MARKER, 'true');
        markedBlocks.push(block);
      }
    });

    logger.info(`Marked ${markedBlocks.length} code blocks for preservation`, {
      preElements: preElements.length,
      blockLevelCode: codeBlocks.filter(b => b.isBlockLevel).length,
      totalMarked: markedBlocks.length
    });

    return markedBlocks;
  } catch (error) {
    logger.error('Error marking code blocks for preservation', error as Error);
    return markedBlocks;
  }
}

/**
 * Remove preservation markers from HTML content
 *
 * @param html - HTML string to clean
 * @returns HTML with markers removed
 */
function cleanPreservationMarkers(html: string): string {
  if (!html) return html;

  try {
    // Remove the preservation marker attribute from HTML
    return html.replace(new RegExp(` ${PRESERVE_MARKER}="true"`, 'g'), '');
  } catch (error) {
    logger.error('Error cleaning preservation markers', error as Error);
    return html; // Return original if cleaning fails
  }
}

/**
 * Store references to original Readability methods
 *
 * @param ReadabilityClass - Readability constructor/class
 * @returns Object containing original methods
 */
function storeOriginalMethods(ReadabilityClass: any): OriginalMethods {
  const original: OriginalMethods = {};

  try {
    if (ReadabilityClass && ReadabilityClass.prototype) {
      // Store original methods if they exist
      if (typeof ReadabilityClass.prototype._clean === 'function') {
        original._clean = ReadabilityClass.prototype._clean;
      }
      if (typeof ReadabilityClass.prototype._removeNodes === 'function') {
        original._removeNodes = ReadabilityClass.prototype._removeNodes;
      }
      if (typeof ReadabilityClass.prototype._cleanConditionally === 'function') {
        original._cleanConditionally = ReadabilityClass.prototype._cleanConditionally;
      }

      logger.debug('Stored original Readability methods', {
        hasClean: !!original._clean,
        hasRemoveNodes: !!original._removeNodes,
        hasCleanConditionally: !!original._cleanConditionally
      });
    } else {
      logger.warn('Readability prototype not available for method storage');
    }
  } catch (error) {
    logger.error('Error storing original Readability methods', error as Error);
  }

  return original;
}

/**
 * Restore original Readability methods
 *
 * @param ReadabilityClass - Readability constructor/class
 * @param original - Object containing original methods to restore
 */
function restoreOriginalMethods(ReadabilityClass: any, original: OriginalMethods): void {
  try {
    if (!ReadabilityClass || !ReadabilityClass.prototype) {
      logger.warn('Cannot restore methods: Readability prototype not available');
      return;
    }

    // Restore methods if we have backups
    if (original._clean) {
      ReadabilityClass.prototype._clean = original._clean;
    }
    if (original._removeNodes) {
      ReadabilityClass.prototype._removeNodes = original._removeNodes;
    }
    if (original._cleanConditionally) {
      ReadabilityClass.prototype._cleanConditionally = original._cleanConditionally;
    }

    logger.debug('Restored original Readability methods');
  } catch (error) {
    logger.error('Error restoring original Readability methods', error as Error);
  }
}

/**
 * Apply monkey-patches to Readability methods
 *
 * @param ReadabilityClass - Readability constructor/class
 * @param original - Original methods (for calling)
 */
function applyMonkeyPatches(ReadabilityClass: any, original: OriginalMethods): void {
  try {
    if (!ReadabilityClass || !ReadabilityClass.prototype) {
      logger.warn('Cannot apply patches: Readability prototype not available');
      return;
    }

    // Override _clean method
    if (original._clean && typeof original._clean === 'function') {
      ReadabilityClass.prototype._clean = function (e: Element) {
        if (!e) return;

        // Skip cleaning for preserved elements and their containers
        if (shouldPreserveElement(e)) {
          logger.debug('Skipping _clean for preserved element', {
            tagName: e.tagName,
            hasMarker: e.hasAttribute?.(PRESERVE_MARKER)
          });
          return;
        }

        // Call original method
        original._clean!.call(this, e);
      };
    }

    // Override _removeNodes method
    if (original._removeNodes && typeof original._removeNodes === 'function') {
      ReadabilityClass.prototype._removeNodes = function (nodeList: NodeList | Element[], filterFn?: Function) {
        if (!nodeList || nodeList.length === 0) {
          return;
        }

        // Filter out preserved nodes and their containers
        const filteredList = Array.from(nodeList).filter(node => {
          const element = node as Element;
          if (shouldPreserveElement(element)) {
            logger.debug('Preventing removal of preserved element', {
              tagName: element.tagName,
              hasMarker: element.hasAttribute?.(PRESERVE_MARKER)
            });
            return false; // Don't remove
          }
          return true; // Allow normal processing
        });

        // Call original method with filtered list
        original._removeNodes!.call(this, filteredList, filterFn);
      };
    }

    // Override _cleanConditionally method
    if (original._cleanConditionally && typeof original._cleanConditionally === 'function') {
      ReadabilityClass.prototype._cleanConditionally = function (e: Element, tag: string) {
        if (!e) return;

        // Skip conditional cleaning for preserved elements and their containers
        if (shouldPreserveElement(e)) {
          logger.debug('Skipping _cleanConditionally for preserved element', {
            tagName: e.tagName,
            tag: tag,
            hasMarker: e.hasAttribute?.(PRESERVE_MARKER)
          });
          return;
        }

        // Call original method
        original._cleanConditionally!.call(this, e, tag);
      };
    }

    logger.info('Successfully applied Readability monkey-patches');
  } catch (error) {
    logger.error('Error applying monkey-patches to Readability', error as Error);
    throw error; // Re-throw to trigger cleanup
  }
}

/**
 * Extract article content with code block preservation
 *
 * This is the main entry point for the module. It:
 * 1. Detects and marks code blocks in the document
 * 2. Stores original Readability methods
 * 3. Applies monkey-patches to preserve marked blocks
 * 4. Runs Readability extraction
 * 5. Cleans up markers from output
 * 6. Restores original methods (always, via try-finally)
 *
 * @param document - Document to extract from (will be cloned internally)
 * @param ReadabilityClass - Readability constructor (pass the class, not an instance)
 * @returns Extraction result with preserved code blocks, or null if extraction fails
 *
 * @example
 * ```typescript
 * import { Readability } from '@mozilla/readability';
 * import { extractWithCodeBlockPreservation } from './readability-code-preservation';
 *
 * const documentCopy = document.cloneNode(true) as Document;
 * const article = extractWithCodeBlockPreservation(documentCopy, Readability);
 * if (article) {
 *   console.log(`Preserved ${article.codeBlocksPreserved} code blocks`);
 * }
 * ```
 */
export function extractWithCodeBlockPreservation(
  document: Document,
  ReadabilityClass: typeof Readability
): ExtractionResult | null {
  // Validate inputs
  if (!document || !document.body) {
    logger.error('Invalid document provided for extraction');
    return null;
  }

  if (!ReadabilityClass) {
    logger.error('Readability class not provided');
    return null;
  }

  logger.info('Starting extraction with code block preservation');

  // Store original methods
  const originalMethods = storeOriginalMethods(ReadabilityClass);

  // Check if we can apply patches
  const canPatch = originalMethods._clean || originalMethods._removeNodes || originalMethods._cleanConditionally;
  if (!canPatch) {
    logger.warn('No Readability methods available to patch, falling back to vanilla extraction');
    try {
      const readability = new ReadabilityClass(document);
      const article = readability.parse();
      if (!article) return null;
      return {
        ...article,
        preservationApplied: false,
        codeBlocksPreserved: 0
      };
    } catch (error) {
      logger.error('Vanilla Readability extraction failed', error as Error);
      return null;
    }
  }

  try {
    // Step 1: Mark code blocks for preservation
    const markedBlocks = markCodeBlocksForPreservation(document);

    // Step 2: Apply monkey-patches
    applyMonkeyPatches(ReadabilityClass, originalMethods);

    // Step 3: Run Readability extraction with protections in place
    logger.debug('Running Readability with code preservation active');
    const readability = new ReadabilityClass(document);
    const article = readability.parse();

    if (!article) {
      logger.warn('Readability returned null article');
      return null;
    }

    // Step 4: Clean up preservation markers from output
    const cleanedContent = cleanPreservationMarkers(article.content);

    // Return result with preservation metadata
    const result: ExtractionResult = {
      ...article,
      content: cleanedContent,
      codeBlocksPreserved: markedBlocks.length,
      preservationApplied: true
    };

    logger.info('Extraction with code preservation complete', {
      title: result.title,
      contentLength: result.content.length,
      codeBlocksPreserved: result.codeBlocksPreserved,
      preservationApplied: result.preservationApplied
    });

    return result;
  } catch (error) {
    logger.error('Error during extraction with code preservation', error as Error);
    return null;
  } finally {
    // Step 5: Always restore original methods (even if extraction failed)
    restoreOriginalMethods(ReadabilityClass, originalMethods);
    logger.debug('Cleanup complete: original methods restored');
  }
}

/**
 * Run vanilla Readability without code preservation
 *
 * This is a wrapper function for consistency and error handling.
 * Use this when code preservation is not needed.
 *
 * @param document - Document to extract from
 * @param ReadabilityClass - Readability constructor
 * @returns Extraction result, or null if extraction fails
 *
 * @example
 * ```typescript
 * import { Readability } from '@mozilla/readability';
 * import { runVanillaReadability } from './readability-code-preservation';
 *
 * const documentCopy = document.cloneNode(true) as Document;
 * const article = runVanillaReadability(documentCopy, Readability);
 * ```
 */
export function runVanillaReadability(
  document: Document,
  ReadabilityClass: typeof Readability
): ExtractionResult | null {
  try {
    if (!document || !document.body) {
      logger.error('Invalid document provided for vanilla extraction');
      return null;
    }

    if (!ReadabilityClass) {
      logger.error('Readability class not provided for vanilla extraction');
      return null;
    }

    logger.info('Running vanilla Readability extraction (no code preservation)');

    const readability = new ReadabilityClass(document);
    const article = readability.parse();

    if (!article) {
      logger.warn('Vanilla Readability returned null article');
      return null;
    }

    const result: ExtractionResult = {
      ...article,
      preservationApplied: false,
      codeBlocksPreserved: 0
    };

    logger.info('Vanilla extraction complete', {
      title: result.title,
      contentLength: result.content.length
    });

    return result;
  } catch (error) {
    logger.error('Error during vanilla Readability extraction', error as Error);
    return null;
  }
}
