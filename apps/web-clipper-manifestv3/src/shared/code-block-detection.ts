/**
 * Code Block Detection Module
 *
 * Provides functionality to detect and analyze code blocks in HTML documents.
 * Distinguishes between inline code and block-level code elements, and provides
 * metadata about code blocks for preservation during article extraction.
 *
 * @module codeBlockDetection
 */

import { Logger } from './utils';

const logger = Logger.create('CodeBlockDetection', 'content');

/**
 * Metadata about a detected code block
 */
export interface CodeBlockMetadata {
  /** The code block element */
  element: HTMLElement;
  /** Whether this is a block-level code element (vs inline) */
  isBlockLevel: boolean;
  /** The text content of the code block */
  content: string;
  /** Length of the code content in characters */
  length: number;
  /** Number of lines in the code block */
  lineCount: number;
  /** Whether the element has syntax highlighting classes */
  hasSyntaxHighlighting: boolean;
  /** CSS classes applied to the element */
  classes: string[];
  /** Importance score (0-1, for future enhancements) */
  importance: number;
}

/**
 * Configuration options for code block detection
 */
export interface CodeBlockDetectionOptions {
  /** Minimum character length to consider as block-level code */
  minBlockLength?: number;
  /** Whether to include inline code elements in results */
  includeInline?: boolean;
}

const DEFAULT_OPTIONS: Required<CodeBlockDetectionOptions> = {
  minBlockLength: 80,
  includeInline: false,
};

/**
 * Common syntax highlighting class prefixes used by popular libraries
 */
const SYNTAX_HIGHLIGHTING_PATTERNS = [
  /^lang-/i,          // Markdown/Jekyll style
  /^language-/i,      // Prism.js, highlight.js
  /^hljs-/i,          // highlight.js
  /^brush:/i,         // SyntaxHighlighter
  /^prettyprint/i,    // Google Code Prettify
  /^cm-/i,            // CodeMirror
  /^ace_/i,           // Ace Editor
  /^token/i,          // Prism.js tokens
  /^pl-/i,            // GitHub's syntax highlighting
];

/**
 * Common code block wrapper class patterns
 */
const CODE_WRAPPER_PATTERNS = [
  /^code/i,
  /^source/i,
  /^highlight/i,
  /^syntax/i,
  /^program/i,
  /^snippet/i,
];

/**
 * Detect all code blocks in a document
 *
 * @param document - The document to scan for code blocks
 * @param options - Configuration options for detection
 * @returns Array of code block metadata objects
 *
 * @example
 * ```typescript
 * const codeBlocks = detectCodeBlocks(document);
 * console.log(`Found ${codeBlocks.length} code blocks`);
 * ```
 */
export function detectCodeBlocks(
  document: Document,
  options: CodeBlockDetectionOptions = {}
): CodeBlockMetadata[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  try {
    logger.debug('Starting code block detection', { options: opts });

    if (!document || !document.body) {
      logger.warn('Invalid document provided - no body element');
      return [];
    }

    const codeBlocks: CodeBlockMetadata[] = [];

    // Find all <pre> and <code> elements
    const preElements = document.querySelectorAll('pre');
    const codeElements = document.querySelectorAll('code');

    logger.debug('Found potential code elements', {
      preElements: preElements.length,
      codeElements: codeElements.length,
    });

    // Process <pre> elements (typically block-level)
    preElements.forEach((pre) => {
      try {
        const metadata = analyzeCodeElement(pre as HTMLElement, opts);
        if (metadata && (opts.includeInline || metadata.isBlockLevel)) {
          codeBlocks.push(metadata);
        }
      } catch (error) {
        logger.error('Error analyzing <pre> element', error instanceof Error ? error : new Error(String(error)));
      }
    });

    // Process standalone <code> elements (check if block-level)
    codeElements.forEach((code) => {
      try {
        // Skip if already processed as part of a <pre> tag
        if (code.closest('pre')) {
          return;
        }

        const metadata = analyzeCodeElement(code as HTMLElement, opts);
        if (metadata && (opts.includeInline || metadata.isBlockLevel)) {
          codeBlocks.push(metadata);
        }
      } catch (error) {
        logger.error('Error analyzing <code> element', error instanceof Error ? error : new Error(String(error)));
      }
    });

    logger.info('Code block detection complete', {
      totalFound: codeBlocks.length,
      blockLevel: codeBlocks.filter(cb => cb.isBlockLevel).length,
      inline: codeBlocks.filter(cb => !cb.isBlockLevel).length,
    });

    return codeBlocks;
  } catch (error) {
    logger.error('Code block detection failed', error instanceof Error ? error : new Error(String(error)));
    return [];
  }
}

/**
 * Analyze a code element and create metadata
 *
 * @param element - The code element to analyze
 * @param options - Detection options
 * @returns Code block metadata or null if element is invalid
 */
function analyzeCodeElement(
  element: HTMLElement,
  options: Required<CodeBlockDetectionOptions>
): CodeBlockMetadata | null {
  try {
    const content = element.textContent || '';
    const length = content.length;
    const lineCount = content.split('\n').length;
    const classes = Array.from(element.classList);
    const hasSyntaxHighlighting = hasSyntaxHighlightingClass(classes);
    const isBlockLevel = isBlockLevelCode(element, options);

    const metadata: CodeBlockMetadata = {
      element,
      isBlockLevel,
      content,
      length,
      lineCount,
      hasSyntaxHighlighting,
      classes,
      importance: calculateImportance(element, length, lineCount, hasSyntaxHighlighting),
    };

    return metadata;
  } catch (error) {
    logger.error('Error creating code element metadata', error instanceof Error ? error : new Error(String(error)));
    return null;
  }
}

/**
 * Determine if a code element is block-level (vs inline)
 *
 * Uses multiple heuristics:
 * 1. Element type (<pre> is always block-level)
 * 2. Presence of newlines (multi-line code)
 * 3. Length threshold (>80 chars)
 * 4. Parent-child content ratio
 * 5. Syntax highlighting classes
 * 6. Code block wrapper classes
 * 7. Display style
 *
 * @param codeElement - The code element to analyze
 * @param options - Detection options containing minBlockLength
 * @returns true if the element should be treated as block-level code
 *
 * @example
 * ```typescript
 * const pre = document.querySelector('pre');
 * if (isBlockLevelCode(pre)) {
 *   console.log('This is a code block');
 * }
 * ```
 */
export function isBlockLevelCode(
  codeElement: HTMLElement,
  options: Required<CodeBlockDetectionOptions> = DEFAULT_OPTIONS
): boolean {
  try {
    // Heuristic 1: <pre> elements are always block-level
    if (codeElement.tagName.toLowerCase() === 'pre') {
      logger.debug('Element is <pre> tag - treating as block-level');
      return true;
    }

    const content = codeElement.textContent || '';
    const classes = Array.from(codeElement.classList);

    // Heuristic 2: Check for newlines (multi-line code)
    if (content.includes('\n')) {
      logger.debug('Element contains newlines - treating as block-level');
      return true;
    }

    // Heuristic 3: Check length threshold
    if (content.length >= options.minBlockLength) {
      logger.debug('Element exceeds length threshold - treating as block-level', {
        length: content.length,
        threshold: options.minBlockLength,
      });
      return true;
    }

    // Heuristic 4: Analyze parent-child content ratio
    // If the code element takes up a significant portion of its parent, it's likely block-level
    const parent = codeElement.parentElement;
    if (parent) {
      const parentContent = parent.textContent || '';
      const ratio = content.length / Math.max(parentContent.length, 1);
      if (ratio > 0.7) {
        logger.debug('Element has high parent-child ratio - treating as block-level', {
          ratio: ratio.toFixed(2),
        });
        return true;
      }
    }

    // Heuristic 5: Check for syntax highlighting classes
    if (hasSyntaxHighlightingClass(classes)) {
      logger.debug('Element has syntax highlighting - treating as block-level', {
        classes,
      });
      return true;
    }

    // Heuristic 6: Check parent for code block wrapper classes
    if (parent && hasCodeWrapperClass(parent)) {
      logger.debug('Parent has code wrapper class - treating as block-level', {
        parentClasses: Array.from(parent.classList),
      });
      return true;
    }

    // Heuristic 7: Check computed display style
    try {
      const style = window.getComputedStyle(codeElement);
      const display = style.display;
      if (display === 'block' || display === 'flex' || display === 'grid') {
        logger.debug('Element has block display style - treating as block-level', {
          display,
        });
        return true;
      }
    } catch (error) {
      // getComputedStyle might fail in some contexts, ignore
      logger.warn('Could not get computed style', error instanceof Error ? error : new Error(String(error)));
    }

    // Default to inline code
    logger.debug('Element does not meet block-level criteria - treating as inline');
    return false;
  } catch (error) {
    logger.error('Error determining if code is block-level', error instanceof Error ? error : new Error(String(error)));
    // Default to false (inline) on error
    return false;
  }
}

/**
 * Check if element has syntax highlighting classes
 *
 * @param classes - Array of CSS class names
 * @returns true if any class matches known syntax highlighting patterns
 */
function hasSyntaxHighlightingClass(classes: string[]): boolean {
  return classes.some(className =>
    SYNTAX_HIGHLIGHTING_PATTERNS.some(pattern => pattern.test(className))
  );
}

/**
 * Check if element has code wrapper classes
 *
 * @param element - The element to check
 * @returns true if element has code wrapper classes
 */
function hasCodeWrapperClass(element: HTMLElement): boolean {
  const classes = Array.from(element.classList);
  return classes.some(className =>
    CODE_WRAPPER_PATTERNS.some(pattern => pattern.test(className))
  );
}

/**
 * Calculate importance score for a code block (0-1)
 *
 * This is a simple implementation for future enhancements.
 * Factors considered:
 * - Length (longer code is more important)
 * - Line count (more lines suggest complete examples)
 * - Syntax highlighting (indicates intentional code display)
 *
 * @param element - The code element
 * @param length - Content length in characters
 * @param lineCount - Number of lines
 * @param hasSyntaxHighlighting - Whether element has syntax highlighting
 * @returns Importance score between 0 and 1
 */
export function calculateImportance(
  element: HTMLElement,
  length: number,
  lineCount: number,
  hasSyntaxHighlighting: boolean
): number {
  try {
    let score = 0;

    // Length factor (0-0.4)
    // Normalize to 0-0.4 with 1000 chars = max
    score += Math.min(length / 1000, 1) * 0.4;

    // Line count factor (0-0.3)
    // Normalize to 0-0.3 with 50 lines = max
    score += Math.min(lineCount / 50, 1) * 0.3;

    // Syntax highlighting bonus (0.2)
    if (hasSyntaxHighlighting) {
      score += 0.2;
    }

    // Element type bonus (0.1)
    if (element.tagName.toLowerCase() === 'pre') {
      score += 0.1;
    }

    return Math.min(score, 1);
  } catch (error) {
    logger.error('Error calculating importance', error instanceof Error ? error : new Error(String(error)));
    return 0.5; // Default middle value on error
  }
}

/**
 * Check if an element contains code blocks
 *
 * Helper function to quickly determine if an element or its descendants
 * contain any code elements without performing full analysis.
 *
 * @param element - The element to check
 * @returns true if element contains <pre> or <code> tags
 *
 * @example
 * ```typescript
 * const article = document.querySelector('article');
 * if (hasCodeChild(article)) {
 *   console.log('This article contains code');
 * }
 * ```
 */
export function hasCodeChild(element: HTMLElement): boolean {
  try {
    if (!element) {
      return false;
    }

    // Check if element itself is a code element
    const tagName = element.tagName.toLowerCase();
    if (tagName === 'pre' || tagName === 'code') {
      return true;
    }

    // Check for code element descendants
    const hasPreChild = element.querySelector('pre') !== null;
    const hasCodeChild = element.querySelector('code') !== null;

    return hasPreChild || hasCodeChild;
  } catch (error) {
    logger.error('Error checking for code children', error instanceof Error ? error : new Error(String(error)));
    return false;
  }
}

/**
 * Get statistics about code blocks in a document
 *
 * @param document - The document to analyze
 * @returns Statistics object
 *
 * @example
 * ```typescript
 * const stats = getCodeBlockStats(document);
 * console.log(`Found ${stats.totalBlocks} code blocks`);
 * ```
 */
export function getCodeBlockStats(document: Document): {
  totalBlocks: number;
  blockLevelBlocks: number;
  inlineBlocks: number;
  totalLines: number;
  totalCharacters: number;
  hasSyntaxHighlighting: number;
} {
  try {
    const codeBlocks = detectCodeBlocks(document, { includeInline: true });

    const stats = {
      totalBlocks: codeBlocks.length,
      blockLevelBlocks: codeBlocks.filter(cb => cb.isBlockLevel).length,
      inlineBlocks: codeBlocks.filter(cb => !cb.isBlockLevel).length,
      totalLines: codeBlocks.reduce((sum, cb) => sum + cb.lineCount, 0),
      totalCharacters: codeBlocks.reduce((sum, cb) => sum + cb.length, 0),
      hasSyntaxHighlighting: codeBlocks.filter(cb => cb.hasSyntaxHighlighting).length,
    };

    logger.info('Code block statistics', stats);
    return stats;
  } catch (error) {
    logger.error('Error getting code block stats', error instanceof Error ? error : new Error(String(error)));
    return {
      totalBlocks: 0,
      blockLevelBlocks: 0,
      inlineBlocks: 0,
      totalLines: 0,
      totalCharacters: 0,
      hasSyntaxHighlighting: 0,
    };
  }
}
