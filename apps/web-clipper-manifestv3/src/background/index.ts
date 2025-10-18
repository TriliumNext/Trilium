import { Logger, Utils, MessageUtils } from '@/shared/utils';
import { ExtensionMessage, ClipData, TriliumResponse, ContentScriptErrorMessage } from '@/shared/types';
import { triliumServerFacade } from '@/shared/trilium-server';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import * as cheerio from 'cheerio';

const logger = Logger.create('Background', 'background');

/**
 * Background service worker for the Trilium Web Clipper extension
 * Handles extension lifecycle, message routing, and core functionality
 */
class BackgroundService {
  private isInitialized = false;
  private readyTabs = new Set<number>();  // Track tabs with ready content scripts

  constructor() {
    this.initialize();
  }

  private async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      logger.info('Initializing background service...');

      this.setupEventHandlers();
      this.setupContextMenus();
      await this.loadConfiguration();

      this.isInitialized = true;
      logger.info('Background service initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize background service', error as Error);
    }
  }

  private setupEventHandlers(): void {
    // Installation and update events
    chrome.runtime.onInstalled.addListener(this.handleInstalled.bind(this));

    // Message handling
    chrome.runtime.onMessage.addListener(
      MessageUtils.createResponseHandler(this.handleMessage.bind(this), 'background')
    );

    // Command handling (keyboard shortcuts)
    chrome.commands.onCommand.addListener(this.handleCommand.bind(this));

    // Context menu clicks
    chrome.contextMenus.onClicked.addListener(this.handleContextMenuClick.bind(this));

    // Tab lifecycle - cleanup ready tabs tracking
    chrome.tabs.onRemoved.addListener((tabId) => {
      this.readyTabs.delete(tabId);
      logger.debug('Tab removed from ready tracking', { tabId, remainingCount: this.readyTabs.size });
    });
  }

  private async handleInstalled(details: chrome.runtime.InstalledDetails): Promise<void> {
    logger.info('Extension installed/updated', { reason: details.reason });

    if (details.reason === 'install') {
      // Set default configuration
      await this.setDefaultConfiguration();

      // Open options page for initial setup
      chrome.runtime.openOptionsPage();
    }
  }

  private async handleMessage(message: unknown, _sender: chrome.runtime.MessageSender): Promise<unknown> {
    const typedMessage = message as ExtensionMessage;
    logger.debug('Received message', { type: typedMessage.type });

    try {
      switch (typedMessage.type) {
        case 'SAVE_SELECTION':
          return await this.saveSelection();

        case 'SAVE_PAGE':
          return await this.savePage();

        case 'SAVE_SCREENSHOT':
          return await this.saveScreenshot(typedMessage.cropRect);

        case 'CHECK_EXISTING_NOTE':
          return await this.checkForExistingNote(typedMessage.url);

        case 'OPEN_NOTE':
          return await this.openNoteInTrilium(typedMessage.noteId);

        case 'TEST_CONNECTION':
          return await this.testConnection(typedMessage.serverUrl, typedMessage.authToken, typedMessage.desktopPort);

        case 'GET_CONNECTION_STATUS':
          return triliumServerFacade.getConnectionStatus();

        case 'TRIGGER_CONNECTION_SEARCH':
          await triliumServerFacade.triggerSearchForTrilium();
          return { success: true };

        case 'SHOW_TOAST':
          return await this.showToast(typedMessage.message, typedMessage.variant, typedMessage.duration);

        case 'LOAD_SCRIPT':
          return await this.loadScript(typedMessage.scriptPath);

        case 'CONTENT_SCRIPT_READY':
          if (_sender.tab?.id) {
            this.readyTabs.add(_sender.tab.id);
            logger.info('Content script reported ready', {
              tabId: _sender.tab.id,
              url: typedMessage.url,
              readyTabsCount: this.readyTabs.size
            });
          }
          return { success: true };

        case 'CONTENT_SCRIPT_ERROR':
          logger.error('Content script reported error', new Error((typedMessage as ContentScriptErrorMessage).error));
          return { success: true };

        default:
          logger.warn('Unknown message type', { message });
          return { success: false, error: 'Unknown message type' };
      }
    } catch (error) {
      logger.error('Error handling message', error as Error, { message });
      return { success: false, error: (error as Error).message };
    }
  }

  private async handleCommand(command: string): Promise<void> {
    logger.debug('Command received', { command });

    try {
      switch (command) {
        case 'save-selection':
          await this.saveSelection();
          break;

        case 'save-page':
          await this.savePage();
          break;

        case 'save-screenshot':
          await this.saveScreenshot();
          break;

        default:
          logger.warn('Unknown command', { command });
      }
    } catch (error) {
      logger.error('Error handling command', error as Error, { command });
    }
  }

  private async handleContextMenuClick(
    info: chrome.contextMenus.OnClickData,
    _tab?: chrome.tabs.Tab
  ): Promise<void> {
    logger.debug('Context menu clicked', { menuItemId: info.menuItemId });

    try {
      switch (info.menuItemId) {
        case 'save-selection':
          await this.saveSelection();
          break;

        case 'save-page':
          await this.savePage();
          break;

        case 'save-screenshot':
          await this.saveScreenshot();
          break;

        case 'save-link':
          if (info.linkUrl) {
            await this.saveLink(info.linkUrl || '', info.linkUrl || '');
          }
          break;

        case 'save-image':
          if (info.srcUrl) {
            await this.saveImage(info.srcUrl);
          }
          break;
      }
    } catch (error) {
      logger.error('Error handling context menu click', error as Error, { info });
    }
  }

  private setupContextMenus(): void {
    // Remove all existing context menus to prevent duplicates
    chrome.contextMenus.removeAll(() => {
      const menus = [
        {
          id: 'save-selection',
          title: 'Save selection to Trilium',
          contexts: ['selection'] as chrome.contextMenus.ContextType[]
        },
        {
          id: 'save-page',
          title: 'Save page to Trilium',
          contexts: ['page'] as chrome.contextMenus.ContextType[]
        },
        {
          id: 'save-screenshot',
          title: 'Save screenshot to Trilium',
          contexts: ['page'] as chrome.contextMenus.ContextType[]
        },
        {
          id: 'save-link',
          title: 'Save link to Trilium',
          contexts: ['link'] as chrome.contextMenus.ContextType[]
        },
        {
          id: 'save-image',
          title: 'Save image to Trilium',
          contexts: ['image'] as chrome.contextMenus.ContextType[]
        }
      ];

      menus.forEach(menu => {
        chrome.contextMenus.create(menu);
      });

      logger.debug('Context menus created', { count: menus.length });
    });
  }

  private async loadConfiguration(): Promise<void> {
    try {
      const config = await chrome.storage.sync.get();
      logger.debug('Configuration loaded', { config });
    } catch (error) {
      logger.error('Failed to load configuration', error as Error);
    }
  }

  private async setDefaultConfiguration(): Promise<void> {
    const defaultConfig = {
      triliumServerUrl: '',
      autoSave: false,
      defaultNoteTitle: 'Web Clip - {title}',
      enableToasts: true,
      screenshotFormat: 'png',
      screenshotQuality: 0.9
    };

    try {
      await chrome.storage.sync.set(defaultConfig);
      logger.info('Default configuration set');
    } catch (error) {
      logger.error('Failed to set default configuration', error as Error);
    }
  }

  private async getActiveTab(): Promise<chrome.tabs.Tab> {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tabs[0]) {
      throw new Error('No active tab found');
    }

    return tabs[0];
  }

  private isRestrictedUrl(url: string | undefined): boolean {
    if (!url) return true;

    const restrictedPatterns = [
      /^chrome:\/\//,
      /^chrome-extension:\/\//,
      /^about:/,
      /^edge:\/\//,
      /^brave:\/\//,
      /^opera:\/\//,
      /^vivaldi:\/\//,
      /^file:\/\//
    ];

    return restrictedPatterns.some(pattern => pattern.test(url));
  }

  private getDetailedErrorMessage(error: Error, context: string): string {
    const errorMsg = error.message.toLowerCase();

    if (errorMsg.includes('receiving end does not exist')) {
      return `Content script communication failed: The page may not be ready yet. Try refreshing the page or waiting a moment. (${context})`;
    }

    if (errorMsg.includes('timeout') || errorMsg.includes('ping timeout')) {
      return `Page took too long to respond. The page may be slow to load or unresponsive. (${context})`;
    }

    if (errorMsg.includes('restricted url') || errorMsg.includes('cannot inject')) {
      return 'Cannot save content from browser internal pages. Please navigate to a regular web page.';
    }

    if (errorMsg.includes('not ready')) {
      return 'Page is not ready for content extraction. Please wait for the page to fully load.';
    }

    if (errorMsg.includes('no active tab')) {
      return 'No active tab found. Please ensure you have a tab open and try again.';
    }

    return `Failed to communicate with page: ${error.message} (${context})`;
  }

  private async sendMessageToActiveTab(message: unknown): Promise<unknown> {
    const tab = await this.getActiveTab();

    // Check for restricted URLs early
    if (this.isRestrictedUrl(tab.url)) {
      const error = new Error('Cannot access browser internal pages. Please navigate to a web page.');
      logger.warn('Attempted to access restricted URL', { url: tab.url });
      throw error;
    }

    // Trust declarative content_scripts injection from manifest
    // Content scripts are automatically injected for http/https pages at document_idle
    try {
      logger.debug('Sending message to content script', {
        tabId: tab.id,
        messageType: (message as any)?.type,
        isTrackedReady: this.readyTabs.has(tab.id!)
      });
      return await chrome.tabs.sendMessage(tab.id!, message);
    } catch (error) {
      // Edge case: Content script might not be loaded yet (race condition, manual injection, etc.)
      // Simple retry with brief delay - no PING/PONG needed
      logger.debug('Content script not responding, will retry once...', {
        error: (error as Error).message,
        tabId: tab.id
      });

      await Utils.sleep(100);  // Brief delay for content script initialization

      return await chrome.tabs.sendMessage(tab.id!, message);
    }
  }

  private async saveSelection(): Promise<TriliumResponse> {
    logger.info('Saving selection...');

    try {
      const response = await this.sendMessageToActiveTab({
        type: 'GET_SELECTION'
      }) as ClipData;

      // Check for existing note and ask user what to do
      const result = await this.saveTriliumNoteWithDuplicateCheck(response);

      // Show success toast if save was successful
      if (result.success && result.noteId) {
        await this.showToast(
          'Selection saved successfully!',
          'success',
          3000,
          result.noteId
        );
      } else if (!result.success && result.error) {
        await this.showToast(
          `Failed to save selection: ${result.error}`,
          'error',
          5000
        );
      }

      return result;
    } catch (error) {
      const detailedMessage = this.getDetailedErrorMessage(error as Error, 'Save Selection');
      logger.error('Failed to save selection', error as Error);

      // Show error toast
      await this.showToast(
        `Failed to save selection: ${detailedMessage}`,
        'error',
        5000
      );

      return {
        success: false,
        error: detailedMessage
      };
    }
  }

  private async savePage(): Promise<TriliumResponse> {
    logger.info('Saving page...');

    try {
      const response = await this.sendMessageToActiveTab({
        type: 'GET_PAGE_CONTENT'
      }) as ClipData;

      // Check for existing note and ask user what to do
      const result = await this.saveTriliumNoteWithDuplicateCheck(response);

      // Show success toast if save was successful
      if (result.success && result.noteId) {
        await this.showToast(
          'Page saved successfully!',
          'success',
          3000,
          result.noteId
        );
      } else if (!result.success && result.error) {
        await this.showToast(
          `Failed to save page: ${result.error}`,
          'error',
          5000
        );
      }

      return result;
    } catch (error) {
      const detailedMessage = this.getDetailedErrorMessage(error as Error, 'Save Page');
      logger.error('Failed to save page', error as Error);

      // Show error toast
      await this.showToast(
        `Failed to save page: ${detailedMessage}`,
        'error',
        5000
      );

      return {
        success: false,
        error: detailedMessage
      };
    }
  }

  private async saveTriliumNoteWithDuplicateCheck(clipData: ClipData): Promise<TriliumResponse> {
    // Check if a note already exists for this URL
    if (clipData.url) {
      // Check if user has enabled auto-append for duplicates
      const settings = await chrome.storage.sync.get('auto_append_duplicates');
      const autoAppend = settings.auto_append_duplicates === true;

      const existingNote = await triliumServerFacade.checkForExistingNote(clipData.url);

      if (existingNote.exists && existingNote.noteId) {
        logger.info('Found existing note for URL', { url: clipData.url, noteId: existingNote.noteId });

        // If user has enabled auto-append, skip the dialog
        if (autoAppend) {
          logger.info('Auto-appending (user preference)');
          const result = await triliumServerFacade.appendToNote(existingNote.noteId, clipData);

          // Show success toast for append
          if (result.success && result.noteId) {
            await this.showToast(
              'Content appended to existing note!',
              'success',
              3000,
              result.noteId
            );
          } else if (!result.success && result.error) {
            await this.showToast(
              `Failed to append content: ${result.error}`,
              'error',
              5000
            );
          }

          return result;
        }

        // Ask user what to do via popup message
        try {
          const userChoice = await this.sendMessageToActiveTab({
            type: 'SHOW_DUPLICATE_DIALOG',
            existingNoteId: existingNote.noteId,
            url: clipData.url
          }) as { action: 'append' | 'new' | 'cancel' };

          if (userChoice.action === 'cancel') {
            logger.info('User cancelled save operation');
            await this.showToast(
              'Save cancelled',
              'info',
              2000
            );
            return {
              success: false,
              error: 'Save cancelled by user'
            };
          }

          if (userChoice.action === 'new') {
            logger.info('User chose to create new note');
            return await this.saveTriliumNote(clipData, true); // Force new note
          }

          // User chose 'append' - append to existing note
          logger.info('User chose to append to existing note');
          const result = await triliumServerFacade.appendToNote(existingNote.noteId, clipData);

          // Show success toast for append
          if (result.success && result.noteId) {
            await this.showToast(
              'Content appended to existing note!',
              'success',
              3000,
              result.noteId
            );
          } else if (!result.success && result.error) {
            await this.showToast(
              `Failed to append content: ${result.error}`,
              'error',
              5000
            );
          }

          return result;
        } catch (error) {
          logger.warn('Failed to show duplicate dialog or user cancelled', error as Error);
          // If dialog fails, default to creating new note
          return await this.saveTriliumNote(clipData, true);
        }
      }
    }

    // No existing note found, create new one
    return await this.saveTriliumNote(clipData, false);
  }

  private async saveScreenshot(cropRect?: { x: number; y: number; width: number; height: number }): Promise<TriliumResponse> {
    logger.info('Saving screenshot...', { cropRect });

    try {
      let screenshotRect = cropRect;

      // If no crop rectangle provided, prompt user to select area
      if (!screenshotRect) {
        try {
          screenshotRect = await this.sendMessageToActiveTab({
            type: 'GET_SCREENSHOT_AREA'
          }) as { x: number; y: number; width: number; height: number };
        } catch (error) {
          logger.warn('User cancelled screenshot area selection', error as Error);
          await this.showToast(
            'Screenshot cancelled',
            'info',
            2000
          );
          throw new Error('Screenshot cancelled by user');
        }
      }

      // Capture the visible tab
      const tab = await this.getActiveTab();
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
        format: 'png',
        quality: 90
      });

      // If we have a crop rectangle, we'll need to crop the image
      // For now, we'll save the full screenshot with crop info in metadata
      const clipData: ClipData = {
        title: `Screenshot - ${new Date().toLocaleString()}`,
        content: `<img src="${dataUrl}" alt="Screenshot" style="max-width: 100%; height: auto;">`,
        url: tab.url || '',
        type: 'screenshot',
        metadata: {
          screenshotData: {
            dataUrl,
            cropRect: screenshotRect,
            timestamp: new Date().toISOString(),
            tabTitle: tab.title || 'Unknown'
          }
        }
      };

      const result = await this.saveTriliumNote(clipData);

      // Show success toast if save was successful
      if (result.success && result.noteId) {
        await this.showToast(
          'Screenshot saved successfully!',
          'success',
          3000,
          result.noteId
        );
      } else if (!result.success && result.error) {
        await this.showToast(
          `Failed to save screenshot: ${result.error}`,
          'error',
          5000
        );
      }

      return result;
    } catch (error) {
      logger.error('Failed to save screenshot', error as Error);

      // Show error toast if it's not a cancellation
      if (!(error as Error).message.includes('cancelled')) {
        await this.showToast(
          `Failed to save screenshot: ${(error as Error).message}`,
          'error',
          5000
        );
      }

      throw error;
    }
  }

  private async saveLink(url: string, text?: string): Promise<TriliumResponse> {
    logger.info('Saving link...');

    try {
      const clipData: ClipData = {
        title: text || url,
        content: `<a href="${url}">${text || url}</a>`,
        url,
        type: 'link'
      };

      const result = await this.saveTriliumNote(clipData);

      // Show success toast if save was successful
      if (result.success && result.noteId) {
        await this.showToast(
          'Link saved successfully!',
          'success',
          3000,
          result.noteId
        );
      } else if (!result.success && result.error) {
        await this.showToast(
          `Failed to save link: ${result.error}`,
          'error',
          5000
        );
      }

      return result;
    } catch (error) {
      logger.error('Failed to save link', error as Error);

      // Show error toast
      await this.showToast(
        `Failed to save link: ${(error as Error).message}`,
        'error',
        5000
      );

      throw error;
    }
  }

  private async saveImage(_imageUrl: string): Promise<TriliumResponse> {
    logger.info('Saving image...');

    try {
      // TODO: Implement image saving
      throw new Error('Image saving functionality not yet implemented');
    } catch (error) {
      logger.error('Failed to save image', error as Error);
      throw error;
    }
  }

  /**
   * Process images by downloading them in the background context
   * Background scripts don't have CORS restrictions, so we can download any image
   * This matches the MV2 extension architecture
   */
  private async postProcessImages(clipData: ClipData): Promise<void> {
    if (!clipData.images || clipData.images.length === 0) {
      logger.debug('No images to process');
      return;
    }

    logger.info('Processing images in background context', { count: clipData.images.length });

    for (const image of clipData.images) {
      try {
        if (image.src.startsWith('data:image/')) {
          // Already a data URL (from inline images)
          image.dataUrl = image.src;

          // Extract file type for Trilium
          const mimeMatch = image.src.match(/^data:image\/(\w+)/);
          image.src = mimeMatch ? `inline.${mimeMatch[1]}` : 'inline.png';

          logger.debug('Processed inline image', { src: image.src });
        } else {
          // Download image from URL (no CORS restrictions in background!)
          logger.debug('Downloading image', { src: image.src });

          const response = await fetch(image.src);

          if (!response.ok) {
            logger.warn('Failed to fetch image', {
              src: image.src,
              status: response.status
            });
            continue;
          }

          const blob = await response.blob();

          // Convert to base64 data URL
          const reader = new FileReader();
          image.dataUrl = await new Promise<string>((resolve, reject) => {
            reader.onloadend = () => {
              if (typeof reader.result === 'string') {
                resolve(reader.result);
              } else {
                reject(new Error('Failed to convert blob to data URL'));
              }
            };
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
          });

          logger.debug('Successfully downloaded image', {
            src: image.src,
            dataUrlLength: image.dataUrl?.length || 0
          });
        }
      } catch (error) {
        logger.warn(`Failed to process image: ${image.src}`, {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        // Keep original src as fallback - Trilium server will handle it
      }
    }

    logger.info('Completed image processing', {
      total: clipData.images.length,
      successful: clipData.images.filter(img => img.dataUrl).length
    });
  }

  private async saveTriliumNote(clipData: ClipData, forceNew = false): Promise<TriliumResponse> {
    logger.debug('Saving to Trilium', { clipData, forceNew });

    try {
      // ============================================================
      // MV3 COMPLIANT STRATEGY: Send Full HTML to Server
      // ============================================================
      // Per MV3_Compliant_DOM_Capture_and_Server_Parsing_Strategy.md:
      // Content script has already:
      //   1. Serialized full DOM
      //   2. Sanitized with DOMPurify
      //
      // Now we just forward to Trilium server where:
      //   - JSDOM will create virtual DOM
      //   - Readability will extract article content
      //   - Cheerio (via api.cheerio) will do advanced parsing
      // ============================================================

      logger.info('Forwarding sanitized HTML to Trilium server for parsing...');

      // For full page captures, we skip client-side image processing
      // The server will handle image extraction during parsing
      const isFullPageCapture = clipData.metadata?.fullPageCapture === true;

      if (!isFullPageCapture && clipData.images && clipData.images.length > 0) {
        // Only for selections or legacy fallback: process images client-side
        await this.postProcessImages(clipData);
      }

      // Get user's content format preference
      const settings = await chrome.storage.sync.get('contentFormat');
      const format = (settings.contentFormat as 'html' | 'markdown' | 'both') || 'html';

      switch (format) {
        case 'html':
          return await this.saveAsHtml(clipData, forceNew);

        case 'markdown':
          return await this.saveAsMarkdown(clipData, forceNew);

        case 'both':
          return await this.saveAsBoth(clipData, forceNew);

        default:
          return await this.saveAsHtml(clipData, forceNew);
      }
    } catch (error) {
      logger.error('Failed to save to Trilium', error as Error);
      throw error;
    }
  }

  /**
   * Save content as HTML (human-readable format)
   * Applies Phase 3 (Cheerio) processing before sending to Trilium
   */
  private async saveAsHtml(clipData: ClipData, forceNew = false): Promise<TriliumResponse> {
    // Apply Phase 3: Cheerio processing for final cleanup
    const processedContent = this.processWithCheerio(clipData.content);

    return await triliumServerFacade.createNote({
      ...clipData,
      content: processedContent
    }, forceNew);
  }

  /**
   * Save content as Markdown (AI/LLM-friendly format)
   */
  private async saveAsMarkdown(clipData: ClipData, forceNew = false): Promise<TriliumResponse> {
    const markdown = this.convertToMarkdown(clipData.content);

    return await triliumServerFacade.createNote({
      ...clipData,
      content: markdown
    }, forceNew, {
      type: 'code',
      mime: 'text/markdown'
    });
  }

  /**
   * Save both HTML and Markdown versions (HTML parent with markdown child)
   */
  private async saveAsBoth(clipData: ClipData, forceNew = false): Promise<TriliumResponse> {
    // Save HTML parent note
    const parentResponse = await this.saveAsHtml(clipData, forceNew);

    if (!parentResponse.success || !parentResponse.noteId) {
      return parentResponse;
    }

    // Save markdown child note
    const markdown = this.convertToMarkdown(clipData.content);

    try {
      await triliumServerFacade.createChildNote(parentResponse.noteId, {
        title: `${clipData.title} (Markdown)`,
        content: markdown,
        type: clipData.type || 'page',
        url: clipData.url,
        attributes: [
          { type: 'label', name: 'markdownVersion', value: 'true' },
          { type: 'label', name: 'clipType', value: clipData.type || 'page' }
        ]
      });

      logger.info('Created both HTML and Markdown versions', { parentNoteId: parentResponse.noteId });
    } catch (error) {
      logger.warn('Failed to create markdown child note', error as Error);
      // Still return success for the parent note
    }

    return parentResponse;
  }

    /**
   * Phase 3: Cheerio Processing (Background Script)
   * Apply minimal final polish to the HTML before sending to Trilium
   *
   * IMPORTANT: Readability already did heavy lifting (article extraction)
   * DOMPurify already sanitized (security)
   * Cheerio is just for final polish - keep it TARGETED!
   *
   * Focus: Only remove elements that genuinely detract from the reading experience
   * - Social sharing widgets (not social content/mentions in article)
   * - Newsletter signup forms
   * - Tracking pixels
   * - Leftover scripts/event handlers
   */
  private processWithCheerio(html: string): string {
    logger.info('Phase 3: Minimal Cheerio processing for final polish...');

    // Track what we remove for detailed logging
    const removalStats = {
      scripts: 0,
      noscripts: 0,
      styles: 0,
      trackingPixels: 0,
      socialWidgets: 0,
      socialWidgetsByContent: 0,
      newsletterForms: 0,
      eventHandlers: 0,
      totalElements: 0
    };

    try {
      // Load HTML with minimal processing to preserve formatting
      const $ = cheerio.load(html, {
        xml: false
      });

      // Count initial elements
      removalStats.totalElements = $('*').length;
      const initialLength = html.length;

      logger.debug('Pre-Cheerio content stats', {
        totalElements: removalStats.totalElements,
        contentLength: initialLength,
        scripts: $('script').length,
        styles: $('style').length,
        images: $('img').length,
        links: $('a').length
      });

      // ONLY remove truly problematic elements:
      // 1. Scripts/styles that somehow survived (belt & suspenders)
      removalStats.scripts = $('script').length;
      removalStats.noscripts = $('noscript').length;
      removalStats.styles = $('style').length;
      $('script, noscript, style').remove();

      // 2. Obvious tracking pixels (1x1 images)
      const trackingPixels = $('img[width="1"][height="1"]');
      removalStats.trackingPixels = trackingPixels.length;
      if (removalStats.trackingPixels > 0) {
        logger.debug('Removing tracking pixels', {
          count: removalStats.trackingPixels,
          sources: trackingPixels.map((_, el) => $(el).attr('src')).get().slice(0, 5)
        });
      }
      trackingPixels.remove();

      // 3. Social sharing widgets (comprehensive targeted removal)
      //    Use specific selectors to catch various implementations
      const socialSelectors =
        // Common class patterns with hyphens and underscores
        '.share, .sharing, .share-post, .share_post, .share-buttons, .share-button, ' +
        '.share-links, .share-link, .share-tools, .share-bar, .share-icons, ' +
        '.social-share, .social-sharing, .social-buttons, .social-links, .social-icons, ' +
        '.social-media-share, .social-media-links, ' +
        // Third-party sharing tools
        '.shareaholic, .addtoany, .sharethis, .addthis, ' +
        // Attribute contains patterns (catch variations)
        '[class*="share-wrapper"], [class*="share-container"], [class*="share-post"], ' +
        '[class*="share_post"], [class*="sharepost"], ' +
        '[id*="share-buttons"], [id*="social-share"], [id*="share-post"], ' +
        // Common HTML structures for sharing
        'ul[class*="share"], ul[class*="social"], ' +
        'div[class*="share"][class*="bar"], div[class*="social"][class*="bar"], ' +
        // Specific element + class combinations
        'aside[class*="share"], aside[class*="social"]';

      const socialWidgets = $(socialSelectors);
      removalStats.socialWidgets = socialWidgets.length;
      if (removalStats.socialWidgets > 0) {
        logger.debug('Removing social widgets (class-based)', {
          count: removalStats.socialWidgets,
          classes: socialWidgets.map((_, el) => $(el).attr('class')).get().slice(0, 5)
        });
      }
      socialWidgets.remove();

      // 4. Email/Newsletter signup forms (common patterns)
      const newsletterSelectors =
        '.newsletter, .newsletter-signup, .email-signup, .subscribe, .subscription, ' +
        '[class*="newsletter-form"], [class*="email-form"], [class*="subscribe-form"]';

      const newsletterForms = $(newsletterSelectors);
      removalStats.newsletterForms = newsletterForms.length;
      if (removalStats.newsletterForms > 0) {
        logger.debug('Removing newsletter signup forms', {
          count: removalStats.newsletterForms,
          classes: newsletterForms.map((_, el) => $(el).attr('class')).get().slice(0, 5)
        });
      }
      newsletterForms.remove();

      // 5. Smart social link detection - Remove lists/containers with only social media links
      //    This catches cases where class names vary but content is clearly social sharing
      const socialContainersRemoved: Array<{ tag: string; class: string; socialLinks: number; totalLinks: number }> = [];

      $('ul, div').each((_, elem) => {
        const $elem = $(elem);
        const links = $elem.find('a');

        // If element has links, check if they're all social media links
        if (links.length > 0) {
          const socialDomains = [
            'facebook.com', 'twitter.com', 'x.com', 'linkedin.com', 'reddit.com',
            'pinterest.com', 'tumblr.com', 'whatsapp.com', 'telegram.org',
            'instagram.com', 'tiktok.com', 'youtube.com/share', 'wa.me',
            'mailto:', 't.me/', 'mastodon'
          ];

          let socialLinkCount = 0;
          links.each((_, link) => {
            const href = $(link).attr('href') || '';
            if (socialDomains.some(domain => href.includes(domain))) {
              socialLinkCount++;
            }
          });

          // If most/all links are social media (>80%), and it's a small container, remove it
          if (links.length <= 10 && socialLinkCount > 0 && socialLinkCount / links.length >= 0.8) {
            socialContainersRemoved.push({
              tag: elem.tagName.toLowerCase(),
              class: $elem.attr('class') || '(no class)',
              socialLinks: socialLinkCount,
              totalLinks: links.length
            });
            $elem.remove();
          }
        }
      });

      removalStats.socialWidgetsByContent = socialContainersRemoved.length;
      if (removalStats.socialWidgetsByContent > 0) {
        logger.debug('Removing social widgets (content-based detection)', {
          count: removalStats.socialWidgetsByContent,
          examples: socialContainersRemoved.slice(0, 3)
        });
      }

      // 6. Remove ONLY event handlers (onclick, onload, etc.)
      //    Keep data-* attributes as Trilium/CKEditor may use them
      let eventHandlersRemoved = 0;
      $('*').each((_, elem) => {
        const $elem = $(elem);
        const attribs = $elem.attr();
        if (attribs) {
          Object.keys(attribs).forEach(attr => {
            // Only remove event handlers (on*), keep everything else including data-*
            if (attr.startsWith('on') && attr.length > 2) {
              $elem.removeAttr(attr);
              eventHandlersRemoved++;
            }
          });
        }
      });
      removalStats.eventHandlers = eventHandlersRemoved;

      // Get the body content only (cheerio may add html/body wrapper)
      const bodyContent = $('body').html() || $.html();
      const finalLength = bodyContent.length;

      const totalRemoved = removalStats.scripts + removalStats.noscripts + removalStats.styles +
                          removalStats.trackingPixels + removalStats.socialWidgets +
                          removalStats.socialWidgetsByContent + removalStats.newsletterForms;

      logger.info('Phase 3 complete: Minimal Cheerio polish applied', {
        originalLength: initialLength,
        processedLength: finalLength,
        bytesRemoved: initialLength - finalLength,
        reductionPercent: Math.round(((initialLength - finalLength) / initialLength) * 100),
        elementsRemoved: totalRemoved,
        breakdown: {
          scripts: removalStats.scripts,
          noscripts: removalStats.noscripts,
          styles: removalStats.styles,
          trackingPixels: removalStats.trackingPixels,
          socialWidgets: {
            byClass: removalStats.socialWidgets,
            byContent: removalStats.socialWidgetsByContent,
            total: removalStats.socialWidgets + removalStats.socialWidgetsByContent
          },
          newsletterForms: removalStats.newsletterForms,
          eventHandlers: removalStats.eventHandlers
        },
        finalStats: {
          elements: $('*').length,
          images: $('img').length,
          links: $('a').length,
          paragraphs: $('p').length,
          headings: $('h1, h2, h3, h4, h5, h6').length
        }
      });

      return bodyContent;
    } catch (error) {
      logger.error('Failed to process HTML with Cheerio, returning original', error as Error);
      return html; // Return original HTML if processing fails
    }
  }

  /**
   * Convert HTML to Markdown using Turndown
   */
  private convertToMarkdown(html: string): string {
    const turndown = new TurndownService({
      headingStyle: 'atx',
      hr: '---',
      bulletListMarker: '-',
      codeBlockStyle: 'fenced',
      emDelimiter: '_'
    });

    // Add GitHub Flavored Markdown support (tables, strikethrough, etc.)
    turndown.use(gfm);

    return turndown.turndown(html);
  }

  private async showToast(
    message: string,
    variant: 'success' | 'error' | 'info' | 'warning' = 'info',
    duration = 3000,
    noteId?: string
  ): Promise<void> {
    try {
      // Check if user has enabled toast notifications
      const settings = await chrome.storage.sync.get('enableToasts');
      const toastsEnabled = settings.enableToasts !== false; // default to true

      // Log the toast attempt to centralized logging
      logger.info('Toast notification', {
        message,
        variant,
        duration,
        noteId,
        toastsEnabled,
        willDisplay: toastsEnabled
      });

      // Only show toast if user has enabled them
      if (!toastsEnabled) {
        logger.debug('Toast notification suppressed by user setting');
        return;
      }

      await this.sendMessageToActiveTab({
        type: 'SHOW_TOAST',
        message,
        variant,
        duration,
        noteId
      });
    } catch (error) {
      logger.error('Failed to show toast', error as Error);
    }
  }

  private async loadScript(scriptPath: string): Promise<{ success: boolean }> {
    try {
      const tab = await this.getActiveTab();

      await chrome.scripting.executeScript({
        target: { tabId: tab.id! },
        files: [scriptPath]
      });

      logger.debug('Script loaded successfully', { scriptPath });
      return { success: true };
    } catch (error) {
      logger.error('Failed to load script', error as Error, { scriptPath });
      return { success: false };
    }
  }

  private async testConnection(serverUrl?: string, authToken?: string, desktopPort?: string): Promise<unknown> {
    try {
      logger.info('Testing Trilium connections', { serverUrl, desktopPort });

      const results = await triliumServerFacade.testConnection(serverUrl, authToken, desktopPort);

      logger.info('Connection test completed', { results });
      return { success: true, results };
    } catch (error) {
      logger.error('Connection test failed', error as Error);
      return { success: false, error: (error as Error).message };
    }
  }

  private async checkForExistingNote(url: string): Promise<{ exists: boolean; noteId?: string }> {
    try {
      logger.info('Checking for existing note', { url });

      const result = await triliumServerFacade.checkForExistingNote(url);

      logger.info('Check existing note result', {
        url,
        result,
        exists: result.exists,
        noteId: result.noteId
      });

      return result;
    } catch (error) {
      logger.error('Failed to check for existing note', error as Error, { url });
      return { exists: false };
    }
  }

  private async openNoteInTrilium(noteId: string): Promise<{ success: boolean }> {
    try {
      logger.info('Opening note in Trilium', { noteId });

      await triliumServerFacade.openNote(noteId);

      logger.info('Note open request sent successfully');
      return { success: true };
    } catch (error) {
      logger.error('Failed to open note in Trilium', error as Error);
      return { success: false };
    }
  }
}

// Initialize the background service
new BackgroundService();
