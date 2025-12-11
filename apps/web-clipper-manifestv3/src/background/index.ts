import { Logger, Utils, MessageUtils } from '@/shared/utils';
import { ExtensionMessage, ClipData, TriliumResponse, ContentScriptErrorMessage } from '@/shared/types';
import { triliumServerFacade } from '@/shared/trilium-server';
import { initializeDefaultSettings } from '@/shared/code-block-settings';
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

      // Initialize code block preservation settings
      await initializeDefaultSettings();

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
          return await this.saveSelection(typedMessage.metaNote);

        case 'SAVE_PAGE':
          return await this.savePage(typedMessage.metaNote);

        case 'SAVE_SCREENSHOT':
          return await this.saveScreenshot(typedMessage.cropRect, typedMessage.metaNote);

        case 'SAVE_CROPPED_SCREENSHOT':
          return await this.saveScreenshot(undefined, typedMessage.metaNote); // Will prompt user for crop area

        case 'SAVE_FULL_SCREENSHOT':
          return await this.saveScreenshot({ fullScreen: true } as any, typedMessage.metaNote);

        case 'SAVE_LINK':
          return await this.saveLinkWithNote(typedMessage.url, typedMessage.title, typedMessage.content, typedMessage.keepTitle);

        case 'SAVE_TABS':
          return await this.saveTabs();

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

        case 'save-tabs':
          await this.saveTabs();
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

        case 'save-cropped-screenshot':
          await this.saveScreenshot(); // Will prompt for crop area
          break;

        case 'save-full-screenshot':
          await this.saveScreenshot({ fullScreen: true } as any);
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

        case 'save-tabs':
          await this.saveTabs();
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
          title: 'Save selection',
          contexts: ['selection'] as chrome.contextMenus.ContextType[]
        },
        {
          id: 'save-page',
          title: 'Save page',
          contexts: ['page'] as chrome.contextMenus.ContextType[]
        },
        {
          id: 'save-cropped-screenshot',
          title: 'Save screenshot (Crop)',
          contexts: ['page'] as chrome.contextMenus.ContextType[]
        },
        {
          id: 'save-full-screenshot',
          title: 'Save screenshot (Full)',
          contexts: ['page'] as chrome.contextMenus.ContextType[]
        },
        {
          id: 'save-link',
          title: 'Save link',
          contexts: ['link'] as chrome.contextMenus.ContextType[]
        },
        {
          id: 'save-image',
          title: 'Save image',
          contexts: ['image'] as chrome.contextMenus.ContextType[]
        },
        {
          id: 'save-tabs',
          title: 'Save all tabs',
          contexts: ['page'] as chrome.contextMenus.ContextType[]
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
      // Edge case: Content script might not be loaded yet
      // Try to inject it programmatically
      logger.debug('Content script not responding, attempting to inject...', {
        error: (error as Error).message,
        tabId: tab.id
      });

      try {
        // Inject content script programmatically
        await chrome.scripting.executeScript({
          target: { tabId: tab.id! },
          files: ['content.js']
        });

        logger.debug('Content script injected successfully, retrying message');

        // Wait a moment for the script to initialize
        await Utils.sleep(200);

        // Try sending the message again
        return await chrome.tabs.sendMessage(tab.id!, message);
      } catch (injectError) {
        logger.error('Failed to inject content script', injectError as Error);
        throw new Error('Failed to communicate with page. Please refresh the page and try again.');
      }
    }
  }

  private async saveSelection(metaNote?: string): Promise<TriliumResponse> {
    logger.info('Saving selection...', { hasMetaNote: !!metaNote });

    try {
      const response = await this.sendMessageToActiveTab({
        type: 'GET_SELECTION'
      }) as ClipData;

      // Check for existing note and ask user what to do
      const result = await this.saveTriliumNoteWithDuplicateCheck(response, metaNote);

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

  private async savePage(metaNote?: string): Promise<TriliumResponse> {
    logger.info('Saving page...', { hasMetaNote: !!metaNote });

    try {
      const response = await this.sendMessageToActiveTab({
        type: 'GET_PAGE_CONTENT'
      }) as ClipData;

      // Check for existing note and ask user what to do
      const result = await this.saveTriliumNoteWithDuplicateCheck(response, metaNote);

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

  private async saveTriliumNoteWithDuplicateCheck(clipData: ClipData, metaNote?: string): Promise<TriliumResponse> {
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

          // Create meta note child if provided
          if (result.success && result.noteId && metaNote) {
            await this.createMetaNoteChild(result.noteId, metaNote);
          }

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
            return await this.saveTriliumNote(clipData, true, metaNote); // Force new note
          }

          // User chose 'append' - append to existing note
          logger.info('User chose to append to existing note');
          const result = await triliumServerFacade.appendToNote(existingNote.noteId, clipData);

          // Create meta note child if provided
          if (result.success && result.noteId && metaNote) {
            await this.createMetaNoteChild(result.noteId, metaNote);
          }

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
          return await this.saveTriliumNote(clipData, true, metaNote);
        }
      }
    }

    // No existing note found, create new one
    return await this.saveTriliumNote(clipData, false, metaNote);
  }

  private async saveScreenshot(cropRect?: { x: number; y: number; width: number; height: number } | { fullScreen: boolean }, metaNote?: string): Promise<TriliumResponse> {
    logger.info('Saving screenshot...', { cropRect, hasMetaNote: !!metaNote });

    try {
      let screenshotRect: { x: number; y: number; width: number; height: number } | undefined;
      let isFullScreen = false;

      // Check if full screen mode is requested
      if (cropRect && 'fullScreen' in cropRect && cropRect.fullScreen) {
        isFullScreen = true;
        screenshotRect = undefined;
      } else if (cropRect && 'x' in cropRect) {
        screenshotRect = cropRect as { x: number; y: number; width: number; height: number };
      } else {
        // No crop rectangle provided, prompt user to select area
        try {
          screenshotRect = await this.sendMessageToActiveTab({
            type: 'GET_SCREENSHOT_AREA'
          }) as { x: number; y: number; width: number; height: number };

          logger.debug('Screenshot area selected', { screenshotRect });
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

      // Validate crop rectangle dimensions (only if cropping)
      if (screenshotRect && !isFullScreen && (screenshotRect.width < 10 || screenshotRect.height < 10)) {
        logger.warn('Screenshot area too small', { screenshotRect });
        await this.showToast(
          'Screenshot area too small (minimum 10x10 pixels)',
          'error',
          3000
        );
        throw new Error('Screenshot area too small');
      }

      // Get active tab
      const tab = await this.getActiveTab();

      if (!tab.id) {
        throw new Error('Unable to get active tab ID');
      }

      // Capture the visible tab
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
        format: 'png'
      });

      let finalDataUrl = dataUrl;

      // If we have a crop rectangle and not in full screen mode, crop the image
      if (screenshotRect && !isFullScreen) {
        // Get zoom level and device pixel ratio for coordinate adjustment
        const zoom = await chrome.tabs.getZoom(tab.id);
        const devicePixelRatio = await this.getDevicePixelRatio(tab.id);
        const totalZoom = zoom * devicePixelRatio;

        logger.debug('Zoom information', { zoom, devicePixelRatio, totalZoom });

        // Adjust crop rectangle for zoom level
        const adjustedRect = {
          x: Math.round(screenshotRect.x * totalZoom),
          y: Math.round(screenshotRect.y * totalZoom),
          width: Math.round(screenshotRect.width * totalZoom),
          height: Math.round(screenshotRect.height * totalZoom)
        };

        logger.debug('Adjusted crop rectangle', { original: screenshotRect, adjusted: adjustedRect });

        finalDataUrl = await this.cropImageWithOffscreen(dataUrl, adjustedRect);
      }

      // Create clip data with the screenshot
      const screenshotType = isFullScreen ? 'Save Screenshot (Full)' : (screenshotRect ? 'Save Screenshot (Crop)' : 'Screenshot');
      const clipData: ClipData = {
        title: `${screenshotType} - ${tab.title || 'Untitled'} - ${new Date().toLocaleString()}`,
        content: `<img src="screenshot.png" alt="Screenshot" style="max-width: 100%; height: auto;">`,
        url: tab.url || '',
        type: 'screenshot',
        images: [{
          imageId: 'screenshot.png',
          src: 'screenshot.png',
          dataUrl: finalDataUrl
        }],
        metadata: {
          screenshotData: {
            screenshotType,
            cropRect: screenshotRect,
            isFullScreen,
            timestamp: new Date().toISOString(),
            tabTitle: tab.title || 'Unknown'
          }
        }
      };

      const result = await this.saveTriliumNote(clipData, false, metaNote);

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

  /**
   * Get the device pixel ratio from the active tab
   */
  private async getDevicePixelRatio(tabId: number): Promise<number> {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => window.devicePixelRatio
      });

      if (results && results[0] && typeof results[0].result === 'number') {
        return results[0].result;
      }

      return 1; // Default if we can't get it
    } catch (error) {
      logger.warn('Failed to get device pixel ratio, using default', error as Error);
      return 1;
    }
  }

  /**
   * Crop an image using an offscreen document
   * Service workers don't have access to Canvas API, so we need an offscreen document
   */
  private async cropImageWithOffscreen(
    dataUrl: string,
    cropRect: { x: number; y: number; width: number; height: number }
  ): Promise<string> {
    try {
      // Try to create offscreen document
      // If it already exists, this will fail silently
      try {
        await chrome.offscreen.createDocument({
          url: 'offscreen.html',
          reasons: ['DOM_SCRAPING' as chrome.offscreen.Reason],
          justification: 'Crop screenshot using Canvas API'
        });

        logger.debug('Offscreen document created for image cropping');
      } catch (error) {
        // Document might already exist, that's fine
        logger.debug('Offscreen document creation skipped (may already exist)');
      }

      // Send message to offscreen document to crop the image
      const response = await chrome.runtime.sendMessage({
        type: 'CROP_IMAGE',
        dataUrl,
        cropRect
      }) as { success: boolean; dataUrl?: string; error?: string };

      if (!response.success || !response.dataUrl) {
        throw new Error(response.error || 'Failed to crop image');
      }

      logger.debug('Image cropped successfully');
      return response.dataUrl;
    } catch (error) {
      logger.error('Failed to crop image with offscreen document', error as Error);
      throw error;
    }
  }

  private async saveLink(url: string, text?: string): Promise<TriliumResponse> {
    logger.info('Saving link (basic - from context menu)...', { url, text });

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

  private async saveLinkWithNote(
    url?: string,
    customTitle?: string,
    customContent?: string,
    keepTitle?: boolean
  ): Promise<TriliumResponse> {
    logger.info('Saving link with note...', { url, customTitle, customContent, keepTitle });

    try {
      // Get the active tab information
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const activeTab = tabs[0];

      if (!activeTab) {
        throw new Error('No active tab found');
      }

      const pageUrl = url || activeTab.url || '';
      const pageTitle = activeTab.title || 'Untitled';

      let finalTitle = '';
      let finalContent = '';

      // Determine the final title and content
      if (!customTitle && !customContent) {
        // No custom text provided - use page title and create a simple link
        finalTitle = pageTitle;
        finalContent = `<a href="${pageUrl}">${pageUrl}</a>`;
      } else if (keepTitle) {
        // Keep page title, use custom content
        finalTitle = pageTitle;
        finalContent = customContent || '';
      } else if (customTitle) {
        // Use custom title
        finalTitle = customTitle;
        finalContent = customContent || '';
      } else {
        // Only custom content provided
        finalTitle = pageTitle;
        finalContent = customContent || '';
      }

      // Build the clip data
      const clipData: ClipData = {
        title: finalTitle,
        content: finalContent,
        url: pageUrl,
        type: 'link',
        metadata: {
          labels: {
            clipType: 'link'
          }
        }
      };

      logger.debug('Prepared link clip data', { clipData });

      // Check for existing note and ask user what to do
      const result = await this.saveTriliumNoteWithDuplicateCheck(clipData);

      // Show success toast if save was successful
      if (result.success && result.noteId) {
        await this.showToast(
          'Link with note saved successfully!',
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
      const detailedMessage = this.getDetailedErrorMessage(error as Error, 'Save Link with Note');
      logger.error('Failed to save link with note', error as Error);

      // Show error toast
      await this.showToast(
        `Failed to save link: ${detailedMessage}`,
        'error',
        5000
      );

      return {
        success: false,
        error: detailedMessage
      };
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
   * Save all tabs in the current window as a single note with links
   */
  private async saveTabs(): Promise<TriliumResponse> {
    logger.info('Saving tabs...');

    try {
      // Get all tabs in the current window
      const tabs = await chrome.tabs.query({ currentWindow: true });

      logger.info('Retrieved tabs for saving', { count: tabs.length });

      if (tabs.length === 0) {
        throw new Error('No tabs found in current window');
      }

      // Build HTML content with list of tab links
      let content = '<ul>\n';
      for (const tab of tabs) {
        const url = tab.url || '';
        const title = tab.title || 'Untitled';

        // Escape HTML entities in title
        const escapedTitle = this.escapeHtml(title);

        content += `  <li><a href="${url}">${escapedTitle}</a></li>\n`;
      }
      content += '</ul>';

      // Create a smart title with domain info
      const domainsCount = new Map<string, number>();
      for (const tab of tabs) {
        if (tab.url) {
          try {
            const hostname = new URL(tab.url).hostname;
            domainsCount.set(hostname, (domainsCount.get(hostname) || 0) + 1);
          } catch (error) {
            // Invalid URL, skip
            logger.debug('Skipping invalid URL for domain extraction', { url: tab.url });
          }
        }
      }

      // Get top 3 domains
      const topDomains = Array.from(domainsCount.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([domain]) => domain)
        .join(', ');

      const title = `${tabs.length} browser tabs${topDomains ? `: ${topDomains}` : ''}${tabs.length > 3 ? '...' : ''}`;

      // Build the clip data
      const clipData: ClipData = {
        title,
        content,
        url: '', // No specific URL for tab collection
        type: 'link', // Using 'link' type since it's a collection of links
        metadata: {
          labels: {
            clipType: 'tabs',
            tabCount: tabs.length.toString()
          }
        }
      };

      logger.debug('Prepared tabs clip data', {
        title,
        tabCount: tabs.length,
        contentLength: content.length
      });

      // Save to Trilium - tabs are always new notes (no duplicate check)
      const result = await triliumServerFacade.createNote(clipData);

      // Show success toast if save was successful
      if (result.success && result.noteId) {
        await this.showToast(
          `${tabs.length} tabs saved successfully!`,
          'success',
          3000,
          result.noteId
        );
      } else if (!result.success && result.error) {
        await this.showToast(
          `Failed to save tabs: ${result.error}`,
          'error',
          5000
        );
      }

      return result;
    } catch (error) {
      const detailedMessage = this.getDetailedErrorMessage(error as Error, 'Save Tabs');
      logger.error('Failed to save tabs', error as Error);

      // Show error toast
      await this.showToast(
        `Failed to save tabs: ${detailedMessage}`,
        'error',
        5000
      );

      return {
        success: false,
        error: detailedMessage
      };
    }
  }

  /**
   * Escape HTML special characters
   * Uses string replacement since service workers don't have DOM access
   */
  private escapeHtml(text: string): string {
    const htmlEscapeMap: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    };

    return text.replace(/[&<>"']/g, (char) => htmlEscapeMap[char] || char);
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

    let successCount = 0;
    let corsErrorCount = 0;
    let otherErrorCount = 0;

    for (const image of clipData.images) {
      try {
        if (image.src.startsWith('data:image/')) {
          // Already a data URL (from inline images)
          image.dataUrl = image.src;

          // Extract file type for Trilium
          const mimeMatch = image.src.match(/^data:image\/(\w+)/);
          image.src = mimeMatch ? `inline.${mimeMatch[1]}` : 'inline.png';

          logger.debug('Processed inline image', { src: image.src });
          successCount++;
        } else {
          // Download image from URL (no CORS restrictions in background!)
          logger.debug('Downloading image', { src: image.src });

          const response = await fetch(image.src);

          if (!response.ok) {
            logger.warn('Failed to fetch image', {
              src: image.src,
              status: response.status,
              statusText: response.statusText
            });
            otherErrorCount++;
            continue;
          }

          const blob = await response.blob();

          // Validate that we received image data
          if (!blob.type.startsWith('image/')) {
            logger.warn('Downloaded file is not an image', {
              src: image.src,
              contentType: blob.type
            });
            otherErrorCount++;
            continue;
          }

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
            contentType: blob.type,
            dataUrlLength: image.dataUrl?.length || 0
          });
          successCount++;
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const isCorsError = errorMessage.includes('CORS') ||
                           errorMessage.includes('NetworkError') ||
                           errorMessage.includes('Failed to fetch');

        if (isCorsError) {
          logger.warn(`CORS or network error downloading image: ${image.src}`, {
            error: errorMessage,
            fallback: 'Trilium server will attempt to download'
          });
          corsErrorCount++;
        } else {
          logger.warn(`Failed to process image: ${image.src}`, {
            error: errorMessage
          });
          otherErrorCount++;
        }
        // Keep original src as fallback - Trilium server will handle it
      }
    }

    logger.info('Completed image processing', {
      total: clipData.images.length,
      successful: successCount,
      corsErrors: corsErrorCount,
      otherErrors: otherErrorCount,
      successRate: `${Math.round((successCount / clipData.images.length) * 100)}%`
    });
  }

  private async saveTriliumNote(clipData: ClipData, forceNew = false, metaNote?: string): Promise<TriliumResponse> {
    logger.debug('Saving to Trilium', { clipData, forceNew, hasMetaNote: !!metaNote });

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

      // Process images for all capture types (selections, full page, etc.)
      // Background scripts don't have CORS restrictions, so we download images here
      // This matches the MV2 extension behavior
      if (clipData.images && clipData.images.length > 0) {
        await this.postProcessImages(clipData);
      }

      // Get user's content format preference
      const settings = await chrome.storage.sync.get('contentFormat');
      const format = (settings.contentFormat as 'html' | 'markdown' | 'both') || 'html';

      switch (format) {
        case 'html':
          return await this.saveAsHtml(clipData, forceNew, metaNote);

        case 'markdown':
          return await this.saveAsMarkdown(clipData, forceNew, metaNote);

        case 'both':
          return await this.saveAsBoth(clipData, forceNew, metaNote);

        default:
          return await this.saveAsHtml(clipData, forceNew, metaNote);
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
  private async saveAsHtml(clipData: ClipData, forceNew = false, metaNote?: string): Promise<TriliumResponse> {
    // Apply Phase 3: Cheerio processing for final cleanup
    const processedContent = this.processWithCheerio(clipData.content);

    const result = await triliumServerFacade.createNote({
      ...clipData,
      content: processedContent
    }, forceNew);

    // Create meta note child if provided
    if (result.success && result.noteId && metaNote) {
      await this.createMetaNoteChild(result.noteId, metaNote);
    }

    return result;
  }

  /**
   * Save content as Markdown (AI/LLM-friendly format)
   */
  private async saveAsMarkdown(clipData: ClipData, forceNew = false, metaNote?: string): Promise<TriliumResponse> {
    const markdown = this.convertToMarkdown(clipData.content);

    const result = await triliumServerFacade.createNote({
      ...clipData,
      content: markdown
    }, forceNew, {
      type: 'code',
      mime: 'text/markdown'
    });

    // Create meta note child if provided
    if (result.success && result.noteId && metaNote) {
      await this.createMetaNoteChild(result.noteId, metaNote);
    }

    return result;
  }

  /**
   * Save both HTML and Markdown versions (HTML parent with markdown child)
   */
  private async saveAsBoth(clipData: ClipData, forceNew = false, metaNote?: string): Promise<TriliumResponse> {
    // Save HTML parent note
    const parentResponse = await this.saveAsHtml(clipData, forceNew, metaNote);

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

    // Enhanced code block handling to preserve language information
    turndown.addRule('codeBlock', {
      filter: (node) => {
        return (
          node.nodeName === 'PRE' &&
          node.firstChild !== null &&
          node.firstChild.nodeName === 'CODE'
        );
      },
      replacement: (content, node) => {
        try {
          const codeElement = (node as HTMLElement).firstChild as HTMLElement;

          // Extract language from class names
          // Common patterns: language-javascript, lang-js, javascript, highlight-js, etc.
          let language = '';
          const className = codeElement.className || '';

          const langMatch = className.match(/(?:language-|lang-|highlight-)([a-zA-Z0-9_-]+)|^([a-zA-Z0-9_-]+)$/);
          if (langMatch) {
            language = langMatch[1] || langMatch[2] || '';
          }

          // Get the code content, preserving whitespace
          const codeContent = codeElement.textContent || '';

          // Clean up the content but preserve essential formatting
          const cleanContent = codeContent.replace(/\n\n\n+/g, '\n\n').trim();

          logger.debug('Converting code block to markdown', {
            language,
            contentLength: cleanContent.length,
            className
          });

          // Return fenced code block with language identifier
          return `\n\n\`\`\`${language}\n${cleanContent}\n\`\`\`\n\n`;
        } catch (error) {
          logger.error('Error converting code block', error as Error);
          // Fallback to default behavior
          return '\n\n```\n' + content + '\n```\n\n';
        }
      }
    });

    // Handle inline code elements
    turndown.addRule('inlineCode', {
      filter: ['code'],
      replacement: (content) => {
        if (!content.trim()) {
          return '';
        }
        // Escape backticks in inline code
        const escapedContent = content.replace(/`/g, '\\`');
        return '`' + escapedContent + '`';
      }
    });

    logger.debug('Converting HTML to Markdown', { htmlLength: html.length });
    const markdown = turndown.turndown(html);
    logger.info('Markdown conversion complete', {
      htmlLength: html.length,
      markdownLength: markdown.length,
      codeBlocks: (markdown.match(/```/g) || []).length / 2
    });

    return markdown;
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

  /**
   * Create a child note with the meta note content
   * This is used to save the user's personal note about why a clip is interesting
   */
  private async createMetaNoteChild(parentNoteId: string, metaNote: string): Promise<void> {
    try {
      logger.info('Creating meta note child', { parentNoteId, metaNoteLength: metaNote.length });

      await triliumServerFacade.createChildNote(parentNoteId, {
        title: 'Why this is interesting',
        content: `<p>${this.escapeHtmlContent(metaNote)}</p>`,
        type: 'page',
        url: '',
        attributes: [
          { type: 'label', name: 'metaNote', value: 'true' },
          { type: 'label', name: 'iconClass', value: 'bx bx-comment-detail' }
        ]
      });

      logger.info('Meta note child created successfully', { parentNoteId });
    } catch (error) {
      logger.error('Failed to create meta note child', error as Error);
      // Don't throw - we don't want to fail the entire save operation if meta note creation fails
    }
  }

  /**
   * Escape HTML content for safe insertion
   */
  private escapeHtmlContent(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
      .replace(/\n/g, '<br>');
  }
}

// Initialize the background service
new BackgroundService();
