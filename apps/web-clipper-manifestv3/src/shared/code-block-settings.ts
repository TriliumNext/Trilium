/**
 * Code Block Preservation Settings Module
 *
 * Manages settings for code block preservation feature including:
 * - Settings schema and TypeScript types
 * - Chrome storage integration (load/save)
 * - Default allow list management
 * - URL/domain matching logic for site-specific preservation
 *
 * @module code-block-settings
 */

import { Logger } from '@/shared/utils';

const logger = Logger.create('CodeBlockSettings', 'background');

/**
 * Storage key for code block preservation settings in Chrome storage
 */
const STORAGE_KEY = 'codeBlockPreservation';

/**
 * Allow list entry type
 * - 'domain': Match by domain (supports wildcards like *.example.com)
 * - 'url': Exact URL match
 */
export type AllowListEntryType = 'domain' | 'url';

/**
 * Individual allow list entry
 */
export interface AllowListEntry {
  /** Entry type (domain or URL) */
  type: AllowListEntryType;
  /** Domain or URL value */
  value: string;
  /** Whether this entry is enabled */
  enabled: boolean;
  /** True if user-added (not part of default list) */
  custom?: boolean;
}

/**
 * Code block preservation settings schema
 */
export interface CodeBlockSettings {
  /** Master toggle for code block preservation feature */
  enabled: boolean;
  /** Automatically detect and preserve code blocks on all sites */
  autoDetect: boolean;
  /** List of domains/URLs where code preservation should be applied */
  allowList: AllowListEntry[];
}

/**
 * Default allow list - popular technical sites where code preservation is beneficial
 *
 * This list includes major developer communities, documentation sites, and technical blogs
 * where users frequently clip articles containing code samples.
 */
function getDefaultAllowList(): AllowListEntry[] {
  return [
    // Developer Q&A and Communities
    { type: 'domain', value: 'stackoverflow.com', enabled: true, custom: false },
    { type: 'domain', value: 'stackexchange.com', enabled: true, custom: false },
    { type: 'domain', value: 'superuser.com', enabled: true, custom: false },
    { type: 'domain', value: 'serverfault.com', enabled: true, custom: false },
    { type: 'domain', value: 'askubuntu.com', enabled: true, custom: false },

    // Code Hosting and Documentation
    { type: 'domain', value: 'github.com', enabled: true, custom: false },
    { type: 'domain', value: 'gitlab.com', enabled: true, custom: false },
    { type: 'domain', value: 'bitbucket.org', enabled: true, custom: false },

    // Technical Blogs and Publishing
    { type: 'domain', value: 'dev.to', enabled: true, custom: false },
    { type: 'domain', value: 'medium.com', enabled: true, custom: false },
    { type: 'domain', value: 'hashnode.dev', enabled: true, custom: false },
    { type: 'domain', value: 'substack.com', enabled: true, custom: false },

    // Official Documentation Sites
    { type: 'domain', value: 'developer.mozilla.org', enabled: true, custom: false },
    { type: 'domain', value: 'docs.python.org', enabled: true, custom: false },
    { type: 'domain', value: 'nodejs.org', enabled: true, custom: false },
    { type: 'domain', value: 'reactjs.org', enabled: true, custom: false },
    { type: 'domain', value: 'vuejs.org', enabled: true, custom: false },
    { type: 'domain', value: 'angular.io', enabled: true, custom: false },
    { type: 'domain', value: 'docs.microsoft.com', enabled: true, custom: false },
    { type: 'domain', value: 'cloud.google.com', enabled: true, custom: false },
    { type: 'domain', value: 'aws.amazon.com', enabled: true, custom: false },

    // Tutorial and Learning Sites
    { type: 'domain', value: 'freecodecamp.org', enabled: true, custom: false },
    { type: 'domain', value: 'codecademy.com', enabled: true, custom: false },
    { type: 'domain', value: 'w3schools.com', enabled: true, custom: false },
    { type: 'domain', value: 'tutorialspoint.com', enabled: true, custom: false },

    // Technical Forums and Wikis
    { type: 'domain', value: 'reddit.com', enabled: true, custom: false },
    { type: 'domain', value: 'discourse.org', enabled: true, custom: false },
  ];
}

/**
 * Default settings used when no saved settings exist
 */
const DEFAULT_SETTINGS: CodeBlockSettings = {
  enabled: true,
  autoDetect: false,
  allowList: getDefaultAllowList(),
};

/**
 * Load code block preservation settings from Chrome storage
 *
 * If no settings exist, returns default settings.
 * Uses chrome.storage.sync for cross-device synchronization.
 *
 * @returns Promise resolving to current settings
 * @throws Never throws - returns defaults on error
 */
export async function loadCodeBlockSettings(): Promise<CodeBlockSettings> {
  try {
    logger.debug('Loading code block settings from storage');

    const result = await chrome.storage.sync.get(STORAGE_KEY);
    const stored = result[STORAGE_KEY] as CodeBlockSettings | undefined;

    if (stored) {
      logger.info('Code block settings loaded from storage', {
        enabled: stored.enabled,
        autoDetect: stored.autoDetect,
        allowListCount: stored.allowList.length,
      });

      // Validate and merge with defaults to ensure schema compatibility
      return validateAndMergeSettings(stored);
    }

    logger.info('No stored settings found, using defaults');
    return { ...DEFAULT_SETTINGS };
  } catch (error) {
    logger.error('Error loading code block settings, returning defaults', error as Error);
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Save code block preservation settings to Chrome storage
 *
 * Uses chrome.storage.sync for cross-device synchronization.
 *
 * @param settings - Settings to save
 * @throws Error if save operation fails
 */
export async function saveCodeBlockSettings(settings: CodeBlockSettings): Promise<void> {
  try {
    logger.debug('Saving code block settings to storage', {
      enabled: settings.enabled,
      autoDetect: settings.autoDetect,
      allowListCount: settings.allowList.length,
    });

    // Validate settings before saving
    const validatedSettings = validateSettings(settings);

    await chrome.storage.sync.set({ [STORAGE_KEY]: validatedSettings });

    logger.info('Code block settings saved successfully');
  } catch (error) {
    logger.error('Error saving code block settings', error as Error);
    throw error;
  }
}

/**
 * Initialize default settings on extension install
 *
 * Should be called from background script's onInstalled handler.
 * Does not overwrite existing settings.
 *
 * @returns Promise resolving when initialization is complete
 */
export async function initializeDefaultSettings(): Promise<void> {
  try {
    logger.debug('Initializing default code block settings');

    const result = await chrome.storage.sync.get(STORAGE_KEY);

    if (!result[STORAGE_KEY]) {
      await saveCodeBlockSettings(DEFAULT_SETTINGS);
      logger.info('Default code block settings initialized');
    } else {
      logger.debug('Code block settings already exist, skipping initialization');
    }
  } catch (error) {
    logger.error('Error initializing default settings', error as Error);
    // Don't throw - initialization failure shouldn't break extension
  }
}

/**
 * Determine if code block preservation should be applied for a given URL
 *
 * Checks in order:
 * 1. If feature is disabled globally, return false
 * 2. If auto-detect is enabled, return true
 * 3. Check if URL matches any enabled allow list entry
 *
 * @param url - URL to check
 * @param settings - Current settings (optional, will load if not provided)
 * @returns Promise resolving to true if preservation should be applied
 */
export async function shouldPreserveCodeForSite(
  url: string,
  settings?: CodeBlockSettings
): Promise<boolean> {
  try {
    // Load settings if not provided
    const currentSettings = settings || (await loadCodeBlockSettings());

    // Check if feature is globally disabled
    if (!currentSettings.enabled) {
      logger.debug('Code block preservation disabled globally');
      return false;
    }

    // Check if auto-detect is enabled
    if (currentSettings.autoDetect) {
      logger.debug('Code block preservation enabled via auto-detect', { url });
      return true;
    }

    // Check allow list
    const shouldPreserve = isUrlInAllowList(url, currentSettings.allowList);

    logger.debug('Checked URL against allow list', {
      url,
      shouldPreserve,
      allowListCount: currentSettings.allowList.length,
    });

    return shouldPreserve;
  } catch (error) {
    logger.error('Error checking if code should be preserved for site', error as Error, { url });
    // On error, default to false to avoid breaking article extraction
    return false;
  }
}

/**
 * Check if a URL matches any entry in the allow list
 *
 * Supports:
 * - Exact URL matching
 * - Domain matching (including subdomains)
 * - Wildcard domain matching (*.example.com)
 *
 * @param url - URL to check
 * @param allowList - Allow list entries to check against
 * @returns True if URL matches any enabled entry
 */
function isUrlInAllowList(url: string, allowList: AllowListEntry[]): boolean {
  try {
    // Parse URL to extract components
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();

    // Check each enabled allow list entry
    for (const entry of allowList) {
      if (!entry.enabled) continue;

      const value = entry.value.toLowerCase();

      if (entry.type === 'url') {
        // Exact URL match
        if (url.toLowerCase() === value || urlObj.href.toLowerCase() === value) {
          logger.debug('URL matched exact allow list entry', { url, entry: value });
          return true;
        }
      } else if (entry.type === 'domain') {
        // Domain match (with wildcard support)
        if (matchesDomain(hostname, value)) {
          logger.debug('URL matched domain allow list entry', { url, domain: value });
          return true;
        }
      }
    }

    return false;
  } catch (error) {
    logger.warn('Error parsing URL for allow list check', { url, error: (error as Error).message });
    return false;
  }
}

/**
 * Check if a hostname matches a domain pattern
 *
 * Supports:
 * - Exact match: example.com matches example.com
 * - Subdomain match: blog.example.com matches example.com
 * - Wildcard match: blog.example.com matches *.example.com
 *
 * @param hostname - Hostname to check (e.g., "blog.example.com")
 * @param pattern - Domain pattern (e.g., "example.com" or "*.example.com")
 * @returns True if hostname matches pattern
 */
function matchesDomain(hostname: string, pattern: string): boolean {
  // Handle wildcard patterns (*.example.com)
  if (pattern.startsWith('*.')) {
    const baseDomain = pattern.substring(2);
    // Match if hostname is the base domain or a subdomain of it
    return hostname === baseDomain || hostname.endsWith('.' + baseDomain);
  }

  // Exact domain match
  if (hostname === pattern) {
    return true;
  }

  // Subdomain match (blog.example.com should match example.com)
  if (hostname.endsWith('.' + pattern)) {
    return true;
  }

  return false;
}

/**
 * Validate domain format
 *
 * Valid formats:
 * - example.com
 * - subdomain.example.com
 * - *.example.com (wildcard)
 *
 * @param domain - Domain to validate
 * @returns True if domain format is valid
 */
export function isValidDomain(domain: string): boolean {
  if (!domain || typeof domain !== 'string') {
    return false;
  }

  const trimmed = domain.trim();

  // Check for wildcard pattern
  if (trimmed.startsWith('*.')) {
    const baseDomain = trimmed.substring(2);
    return isValidDomainWithoutWildcard(baseDomain);
  }

  return isValidDomainWithoutWildcard(trimmed);
}

/**
 * Validate domain format (without wildcard)
 *
 * @param domain - Domain to validate
 * @returns True if domain format is valid
 */
function isValidDomainWithoutWildcard(domain: string): boolean {
  // Basic domain validation regex
  // Allows: letters, numbers, hyphens, dots
  // Must not start/end with hyphen or dot
  const domainRegex = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
  return domainRegex.test(domain);
}

/**
 * Validate URL format
 *
 * @param url - URL to validate
 * @returns True if URL format is valid
 */
export function isValidURL(url: string): boolean {
  if (!url || typeof url !== 'string') {
    return false;
  }

  try {
    const urlObj = new URL(url.trim());
    // Must be HTTP or HTTPS
    return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Normalize an allow list entry
 *
 * - Trims whitespace
 * - Converts to lowercase
 * - Validates format
 * - Returns normalized entry or null if invalid
 *
 * @param entry - Entry to normalize
 * @returns Normalized entry or null if invalid
 */
export function normalizeEntry(entry: AllowListEntry): AllowListEntry | null {
  try {
    const value = entry.value.trim().toLowerCase();

    // Validate based on type
    if (entry.type === 'domain') {
      if (!isValidDomain(value)) {
        logger.warn('Invalid domain format', { value });
        return null;
      }
    } else if (entry.type === 'url') {
      if (!isValidURL(value)) {
        logger.warn('Invalid URL format', { value });
        return null;
      }
    } else {
      logger.warn('Invalid entry type', { type: entry.type });
      return null;
    }

    return {
      type: entry.type,
      value,
      enabled: Boolean(entry.enabled),
      custom: Boolean(entry.custom),
    };
  } catch (error) {
    logger.warn('Error normalizing entry', { entry, error: (error as Error).message });
    return null;
  }
}

/**
 * Validate settings object
 *
 * Ensures all required fields are present and valid.
 * Filters out invalid allow list entries.
 *
 * @param settings - Settings to validate
 * @returns Validated settings
 */
function validateSettings(settings: CodeBlockSettings): CodeBlockSettings {
  // Validate required fields
  const enabled = Boolean(settings.enabled);
  const autoDetect = Boolean(settings.autoDetect);

  // Validate and normalize allow list
  const allowList = Array.isArray(settings.allowList)
    ? settings.allowList.map(normalizeEntry).filter((entry): entry is AllowListEntry => entry !== null)
    : getDefaultAllowList();

  return {
    enabled,
    autoDetect,
    allowList,
  };
}

/**
 * Validate and merge stored settings with defaults
 *
 * Ensures backward compatibility if settings schema changes.
 * Missing fields are filled with default values.
 *
 * @param stored - Stored settings
 * @returns Merged and validated settings
 */
function validateAndMergeSettings(stored: Partial<CodeBlockSettings>): CodeBlockSettings {
  return {
    enabled: stored.enabled !== undefined ? Boolean(stored.enabled) : DEFAULT_SETTINGS.enabled,
    autoDetect: stored.autoDetect !== undefined ? Boolean(stored.autoDetect) : DEFAULT_SETTINGS.autoDetect,
    allowList: Array.isArray(stored.allowList) && stored.allowList.length > 0
      ? stored.allowList.map(normalizeEntry).filter((entry): entry is AllowListEntry => entry !== null)
      : DEFAULT_SETTINGS.allowList,
  };
}

/**
 * Add a custom entry to the allow list
 *
 * @param entry - Entry to add
 * @param settings - Current settings (optional, will load if not provided)
 * @returns Promise resolving to updated settings
 * @throws Error if entry is invalid or already exists
 */
export async function addAllowListEntry(
  entry: Omit<AllowListEntry, 'custom'>,
  settings?: CodeBlockSettings
): Promise<CodeBlockSettings> {
  try {
    // Normalize and validate entry
    const normalized = normalizeEntry({ ...entry, custom: true });
    if (!normalized) {
      throw new Error(`Invalid ${entry.type} format: ${entry.value}`);
    }

    // Load current settings if not provided
    const currentSettings = settings || (await loadCodeBlockSettings());

    // Check for duplicates
    const isDuplicate = currentSettings.allowList.some(
      (existing) => existing.type === normalized.type && existing.value === normalized.value
    );

    if (isDuplicate) {
      throw new Error(`Entry already exists: ${normalized.value}`);
    }

    // Add entry (mark as custom)
    const updatedSettings: CodeBlockSettings = {
      ...currentSettings,
      allowList: [...currentSettings.allowList, { ...normalized, custom: true }],
    };

    // Save updated settings
    await saveCodeBlockSettings(updatedSettings);

    logger.info('Allow list entry added', { entry: normalized });

    return updatedSettings;
  } catch (error) {
    logger.error('Error adding allow list entry', error as Error, { entry });
    throw error;
  }
}

/**
 * Remove an entry from the allow list
 *
 * @param index - Index of entry to remove
 * @param settings - Current settings (optional, will load if not provided)
 * @returns Promise resolving to updated settings
 * @throws Error if index is invalid
 */
export async function removeAllowListEntry(
  index: number,
  settings?: CodeBlockSettings
): Promise<CodeBlockSettings> {
  try {
    // Load current settings if not provided
    const currentSettings = settings || (await loadCodeBlockSettings());

    // Validate index
    if (index < 0 || index >= currentSettings.allowList.length) {
      throw new Error(`Invalid index: ${index}`);
    }

    const entry = currentSettings.allowList[index];

    // Create updated allow list
    const updatedAllowList = [...currentSettings.allowList];
    updatedAllowList.splice(index, 1);

    const updatedSettings: CodeBlockSettings = {
      ...currentSettings,
      allowList: updatedAllowList,
    };

    // Save updated settings
    await saveCodeBlockSettings(updatedSettings);

    logger.info('Allow list entry removed', { index, entry });

    return updatedSettings;
  } catch (error) {
    logger.error('Error removing allow list entry', error as Error, { index });
    throw error;
  }
}

/**
 * Toggle an entry in the allow list (enable/disable)
 *
 * @param index - Index of entry to toggle
 * @param settings - Current settings (optional, will load if not provided)
 * @returns Promise resolving to updated settings
 * @throws Error if index is invalid
 */
export async function toggleAllowListEntry(
  index: number,
  settings?: CodeBlockSettings
): Promise<CodeBlockSettings> {
  try {
    // Load current settings if not provided
    const currentSettings = settings || (await loadCodeBlockSettings());

    // Validate index
    if (index < 0 || index >= currentSettings.allowList.length) {
      throw new Error(`Invalid index: ${index}`);
    }

    // Create updated allow list with toggled entry
    const updatedAllowList = [...currentSettings.allowList];
    updatedAllowList[index] = {
      ...updatedAllowList[index],
      enabled: !updatedAllowList[index].enabled,
    };

    const updatedSettings: CodeBlockSettings = {
      ...currentSettings,
      allowList: updatedAllowList,
    };

    // Save updated settings
    await saveCodeBlockSettings(updatedSettings);

    logger.info('Allow list entry toggled', {
      index,
      entry: updatedAllowList[index],
      enabled: updatedAllowList[index].enabled,
    });

    return updatedSettings;
  } catch (error) {
    logger.error('Error toggling allow list entry', error as Error, { index });
    throw error;
  }
}

/**
 * Reset settings to defaults
 *
 * @returns Promise resolving to default settings
 */
export async function resetToDefaults(): Promise<CodeBlockSettings> {
  try {
    logger.info('Resetting code block settings to defaults');
    await saveCodeBlockSettings(DEFAULT_SETTINGS);
    return { ...DEFAULT_SETTINGS };
  } catch (error) {
    logger.error('Error resetting settings to defaults', error as Error);
    throw error;
  }
}

/**
 * Get the default allow list (for reference/UI purposes)
 *
 * @returns Array of default allow list entries
 */
export function getDefaultAllowListEntries(): AllowListEntry[] {
  return getDefaultAllowList();
}
