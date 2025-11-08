import { Logger, MessageUtils } from '@/shared/utils';
import { ThemeManager } from '@/shared/theme';

const logger = Logger.create('Popup', 'popup');

/**
 * Popup script for the Trilium Web Clipper extension
 * Handles the popup interface and user interactions
 */
class PopupController {
  private elements: { [key: string]: HTMLElement } = {};
  private connectionCheckInterval?: number;

  constructor() {
    this.initialize();
  }

  private async initialize(): Promise<void> {
    try {
      logger.info('Initializing popup...');

      this.cacheElements();
      this.setupEventHandlers();
      await this.initializeTheme();
      await this.loadCurrentPageInfo();
      await this.checkTriliumConnection();
      this.startPeriodicConnectionCheck();

      logger.info('Popup initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize popup', error as Error);
      this.showError('Failed to initialize popup');
    }
  }

  private cacheElements(): void {
    const elementIds = [
      'save-selection',
      'save-page',
      'save-cropped-screenshot',
      'save-full-screenshot',
      'open-settings',
      'back-to-main',
      'view-logs',
      'help',
      'theme-toggle',
      'theme-text',
      'status-message',
      'status-text',
      'progress-bar',
      'page-title',
      'page-url',
      'connection-status',
      'connection-text',
      'settings-panel',
      'settings-form',
      'trilium-url',
      'enable-server',
      'desktop-port',
      'enable-desktop',
      'default-title',
      'auto-save',
      'enable-toasts',
      'screenshot-format',
      'test-connection',
      'persistent-connection-status',
      'connection-result',
      'connection-result-text'
    ];

    elementIds.forEach(id => {
      const element = document.getElementById(id);
      if (element) {
        this.elements[id] = element;
      } else {
        logger.warn(`Element not found: ${id}`);
      }
    });
  }

  private setupEventHandlers(): void {
    // Action buttons
    this.elements['save-selection']?.addEventListener('click', this.handleSaveSelection.bind(this));
    this.elements['save-page']?.addEventListener('click', this.handleSavePage.bind(this));
    this.elements['save-cropped-screenshot']?.addEventListener('click', this.handleSaveCroppedScreenshot.bind(this));
    this.elements['save-full-screenshot']?.addEventListener('click', this.handleSaveFullScreenshot.bind(this));

    // Footer buttons
    this.elements['open-settings']?.addEventListener('click', this.handleOpenSettings.bind(this));
    this.elements['back-to-main']?.addEventListener('click', this.handleBackToMain.bind(this));
    this.elements['view-logs']?.addEventListener('click', this.handleViewLogs.bind(this));
    this.elements['theme-toggle']?.addEventListener('click', this.handleThemeToggle.bind(this));
    this.elements['help']?.addEventListener('click', this.handleHelp.bind(this));

    // Settings form
    this.elements['settings-form']?.addEventListener('submit', this.handleSaveSettings.bind(this));
    this.elements['test-connection']?.addEventListener('click', this.handleTestConnection.bind(this));

    // Theme radio buttons
    const themeRadios = document.querySelectorAll('input[name="theme"]');
    themeRadios.forEach(radio => {
      radio.addEventListener('change', this.handleThemeRadioChange.bind(this));
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', this.handleKeyboardShortcuts.bind(this));
  }

  private handleKeyboardShortcuts(event: KeyboardEvent): void {
    if (event.ctrlKey && event.shiftKey && event.key === 'S') {
      event.preventDefault();
      this.handleSaveSelection();
    } else if (event.altKey && event.shiftKey && event.key === 'S') {
      event.preventDefault();
      this.handleSavePage();
    } else if (event.ctrlKey && event.shiftKey && event.key === 'E') {
      event.preventDefault();
      this.handleSaveCroppedScreenshot();
    }
  }

  private async handleSaveSelection(): Promise<void> {
    logger.info('Save selection requested');

    try {
      this.showProgress('Saving selection...');

      const response = await MessageUtils.sendMessage({
        type: 'SAVE_SELECTION'
      });

      this.showSuccess('Selection saved successfully!');
      logger.info('Selection saved', { response });
    } catch (error) {
      this.showError('Failed to save selection');
      logger.error('Failed to save selection', error as Error);
    }
  }

  private async handleSavePage(): Promise<void> {
    logger.info('Save page requested');

    try {
      this.showProgress('Saving page...');

      const response = await MessageUtils.sendMessage({
        type: 'SAVE_PAGE'
      });

      this.showSuccess('Page saved successfully!');
      logger.info('Page saved', { response });
    } catch (error) {
      this.showError('Failed to save page');
      logger.error('Failed to save page', error as Error);
    }
  }

  private async handleSaveCroppedScreenshot(): Promise<void> {
    logger.info('Save cropped screenshot requested');

    try {
      this.showProgress('Capturing cropped screenshot...');

      const response = await MessageUtils.sendMessage({
        type: 'SAVE_CROPPED_SCREENSHOT'
      });

      this.showSuccess('Screenshot saved successfully!');
      logger.info('Cropped screenshot saved', { response });
    } catch (error) {
      this.showError('Failed to save screenshot');
      logger.error('Failed to save cropped screenshot', error as Error);
    }
  }

  private async handleSaveFullScreenshot(): Promise<void> {
    logger.info('Save full screenshot requested');

    try {
      this.showProgress('Capturing full screenshot...');

      const response = await MessageUtils.sendMessage({
        type: 'SAVE_FULL_SCREENSHOT'
      });

      this.showSuccess('Screenshot saved successfully!');
      logger.info('Full screenshot saved', { response });
    } catch (error) {
      this.showError('Failed to save screenshot');
      logger.error('Failed to save full screenshot', error as Error);
    }
  }

  private handleOpenSettings(): void {
    try {
      logger.info('Opening settings panel');
      this.showSettingsPanel();
    } catch (error) {
      logger.error('Failed to open settings panel', error as Error);
    }
  }

  private handleBackToMain(): void {
    try {
      logger.info('Returning to main panel');
      this.hideSettingsPanel();
    } catch (error) {
      logger.error('Failed to return to main panel', error as Error);
    }
  }

  private showSettingsPanel(): void {
    const settingsPanel = this.elements['settings-panel'];
    if (settingsPanel) {
      settingsPanel.classList.remove('hidden');
      this.loadSettingsData();
    }
  }

  private hideSettingsPanel(): void {
    const settingsPanel = this.elements['settings-panel'];
    if (settingsPanel) {
      settingsPanel.classList.add('hidden');
    }
  }

  private async loadSettingsData(): Promise<void> {
    try {
      const settings = await chrome.storage.sync.get([
        'triliumUrl',
        'enableServer',
        'desktopPort',
        'enableDesktop',
        'defaultTitle',
        'autoSave',
        'enableToasts',
        'screenshotFormat'
      ]);

      // Populate connection form fields
      const urlInput = this.elements['trilium-url'] as HTMLInputElement;
      const enableServerCheck = this.elements['enable-server'] as HTMLInputElement;
      const desktopPortInput = this.elements['desktop-port'] as HTMLInputElement;
      const enableDesktopCheck = this.elements['enable-desktop'] as HTMLInputElement;

      // Populate content form fields
      const titleInput = this.elements['default-title'] as HTMLInputElement;
      const autoSaveCheck = this.elements['auto-save'] as HTMLInputElement;
      const toastsCheck = this.elements['enable-toasts'] as HTMLInputElement;
      const formatSelect = this.elements['screenshot-format'] as HTMLSelectElement;

      // Set connection values
      if (urlInput) urlInput.value = settings.triliumUrl || '';
      if (enableServerCheck) enableServerCheck.checked = settings.enableServer !== false;
      if (desktopPortInput) desktopPortInput.value = settings.desktopPort || '37840';
      if (enableDesktopCheck) enableDesktopCheck.checked = settings.enableDesktop !== false;

      // Set content values
      if (titleInput) titleInput.value = settings.defaultTitle || 'Web Clip - {title}';
      if (autoSaveCheck) autoSaveCheck.checked = settings.autoSave || false;
      if (toastsCheck) toastsCheck.checked = settings.enableToasts !== false;
      if (formatSelect) formatSelect.value = settings.screenshotFormat || 'png';

      // Load theme settings
      const themeConfig = await ThemeManager.getThemeConfig();
      const themeMode = themeConfig.followSystem ? 'system' : themeConfig.mode;
      const themeRadio = document.querySelector(`input[name="theme"][value="${themeMode}"]`) as HTMLInputElement;
      if (themeRadio) themeRadio.checked = true;

    } catch (error) {
      logger.error('Failed to load settings data', error as Error);
    }
  }

  private async handleSaveSettings(event: Event): Promise<void> {
    event.preventDefault();
    try {
      logger.info('Saving settings');

      // Connection settings
      const urlInput = this.elements['trilium-url'] as HTMLInputElement;
      const enableServerCheck = this.elements['enable-server'] as HTMLInputElement;
      const desktopPortInput = this.elements['desktop-port'] as HTMLInputElement;
      const enableDesktopCheck = this.elements['enable-desktop'] as HTMLInputElement;

      // Content settings
      const titleInput = this.elements['default-title'] as HTMLInputElement;
      const autoSaveCheck = this.elements['auto-save'] as HTMLInputElement;
      const toastsCheck = this.elements['enable-toasts'] as HTMLInputElement;
      const formatSelect = this.elements['screenshot-format'] as HTMLSelectElement;

      const settings = {
        triliumUrl: urlInput?.value || '',
        enableServer: enableServerCheck?.checked !== false,
        desktopPort: desktopPortInput?.value || '37840',
        enableDesktop: enableDesktopCheck?.checked !== false,
        defaultTitle: titleInput?.value || 'Web Clip - {title}',
        autoSave: autoSaveCheck?.checked || false,
        enableToasts: toastsCheck?.checked !== false,
        screenshotFormat: formatSelect?.value || 'png'
      };

      await chrome.storage.sync.set(settings);
      this.showSuccess('Settings saved successfully!');

      // Auto-hide settings panel after saving
      setTimeout(() => {
        this.hideSettingsPanel();
      }, 1500);

    } catch (error) {
      logger.error('Failed to save settings', error as Error);
      this.showError('Failed to save settings');
    }
  }

  private async handleTestConnection(): Promise<void> {
    try {
      logger.info('Testing connection');

      // Get connection settings from form
      const urlInput = this.elements['trilium-url'] as HTMLInputElement;
      const enableServerCheck = this.elements['enable-server'] as HTMLInputElement;
      const desktopPortInput = this.elements['desktop-port'] as HTMLInputElement;
      const enableDesktopCheck = this.elements['enable-desktop'] as HTMLInputElement;

      const serverUrl = urlInput?.value?.trim();
      const enableServer = enableServerCheck?.checked;
      const desktopPort = desktopPortInput?.value?.trim() || '37840';
      const enableDesktop = enableDesktopCheck?.checked;

      if (!enableServer && !enableDesktop) {
        this.showConnectionResult('Please enable at least one connection type', 'disconnected');
        return;
      }

      this.showConnectionResult('Testing connections...', 'testing');
      this.updatePersistentStatus('testing', 'Testing connections...');

      // Use the background service to test connections
      const response = await MessageUtils.sendMessage({
        type: 'TEST_CONNECTION',
        serverUrl: enableServer ? serverUrl : undefined,
        authToken: enableServer ? (await this.getStoredAuthToken(serverUrl)) : undefined,
        desktopPort: enableDesktop ? desktopPort : undefined
      }) as { success: boolean; results: any; error?: string };

      if (!response.success) {
        this.showConnectionResult(`Connection test failed: ${response.error}`, 'disconnected');
        this.updatePersistentStatus('disconnected', 'Connection test failed');
        return;
      }

      const connectionResults = this.processConnectionResults(response.results, enableServer, enableDesktop);

      if (connectionResults.hasConnection) {
        this.showConnectionResult(connectionResults.message, 'connected');
        this.updatePersistentStatus('connected', connectionResults.statusTooltip);

        // Trigger a new connection search to update the background service
        await MessageUtils.sendMessage({ type: 'TRIGGER_CONNECTION_SEARCH' });
      } else {
        this.showConnectionResult(connectionResults.message, 'disconnected');
        this.updatePersistentStatus('disconnected', connectionResults.statusTooltip);
      }

    } catch (error) {
      logger.error('Connection test failed', error as Error);
      const errorText = 'Connection test failed - check settings';
      this.showConnectionResult(errorText, 'disconnected');
      this.updatePersistentStatus('disconnected', 'Connection test failed');
    }
  }

  private async getStoredAuthToken(serverUrl?: string): Promise<string | undefined> {
    try {
      if (!serverUrl) return undefined;

      const data = await chrome.storage.sync.get('authToken');
      return data.authToken;
    } catch (error) {
      logger.error('Failed to get stored auth token', error as Error);
      return undefined;
    }
  }

  private processConnectionResults(results: any, enableServer: boolean, enableDesktop: boolean) {
    const connectedSources: string[] = [];
    const failedSources: string[] = [];
    const statusMessages: string[] = [];

    if (enableServer && results.server) {
      if (results.server.connected) {
        connectedSources.push(`Server (${results.server.version || 'Unknown'})`);
        statusMessages.push(`Server: Connected`);
      } else {
        failedSources.push('Server');
      }
    }

    if (enableDesktop && results.desktop) {
      if (results.desktop.connected) {
        connectedSources.push(`Desktop Client (${results.desktop.version || 'Unknown'})`);
        statusMessages.push(`Desktop: Connected`);
      } else {
        failedSources.push('Desktop Client');
      }
    }

    const hasConnection = connectedSources.length > 0;
    let message = '';
    let statusTooltip = '';

    if (hasConnection) {
      message = `Connected to: ${connectedSources.join(', ')}`;
      statusTooltip = statusMessages.join(' | ');
    } else {
      message = `Failed to connect to: ${failedSources.join(', ')}`;
      statusTooltip = 'No connections available';
    }

    return { hasConnection, message, statusTooltip };
  }

  private showConnectionResult(message: string, status: 'connected' | 'disconnected' | 'testing'): void {
    const resultElement = this.elements['connection-result'];
    const textElement = this.elements['connection-result-text'];
    const dotElement = resultElement?.querySelector('.connection-status-dot');

    if (resultElement && textElement && dotElement) {
      resultElement.classList.remove('hidden');
      textElement.textContent = message;

      // Update dot status
      dotElement.classList.remove('connected', 'disconnected', 'testing');
      dotElement.classList.add(status);
    }
  }

  private updatePersistentStatus(status: 'connected' | 'disconnected' | 'testing', tooltip: string): void {
    const persistentStatus = this.elements['persistent-connection-status'];
    const dotElement = persistentStatus?.querySelector('.persistent-status-dot');

    if (persistentStatus && dotElement) {
      // Update dot status
      dotElement.classList.remove('connected', 'disconnected', 'testing');
      dotElement.classList.add(status);

      // Update tooltip
      persistentStatus.setAttribute('title', tooltip);
    }
  }

  private startPeriodicConnectionCheck(): void {
    // Check connection every 30 seconds
    this.connectionCheckInterval = window.setInterval(async () => {
      try {
        await this.checkTriliumConnection();
      } catch (error) {
        logger.error('Periodic connection check failed', error as Error);
      }
    }, 30000);

    // Clean up interval when popup closes
    window.addEventListener('beforeunload', () => {
      if (this.connectionCheckInterval) {
        clearInterval(this.connectionCheckInterval);
      }
    });
  }

  private async handleThemeRadioChange(event: Event): Promise<void> {
    try {
      const target = event.target as HTMLInputElement;
      const mode = target.value as 'light' | 'dark' | 'system';

      logger.info('Theme changed via radio button', { mode });

      if (mode === 'system') {
        await ThemeManager.setThemeConfig({ mode: 'system', followSystem: true });
      } else {
        await ThemeManager.setThemeConfig({ mode, followSystem: false });
      }

      await this.updateThemeButton();

    } catch (error) {
      logger.error('Failed to change theme via radio', error as Error);
    }
  }

  private handleViewLogs(): void {
    logger.info('Opening log viewer');
    chrome.tabs.create({ url: chrome.runtime.getURL('logs.html') });
    window.close();
  }

  private handleHelp(): void {
    logger.info('Opening help');
    const helpUrl = 'https://github.com/zadam/trilium/wiki/Web-clipper';
    chrome.tabs.create({ url: helpUrl });
    window.close();
  }

  private async initializeTheme(): Promise<void> {
    try {
      await ThemeManager.initialize();
      await this.updateThemeButton();
    } catch (error) {
      logger.error('Failed to initialize theme', error as Error);
    }
  }

  private async handleThemeToggle(): Promise<void> {
    try {
      logger.info('Theme toggle requested');
      await ThemeManager.toggleTheme();
      await this.updateThemeButton();
    } catch (error) {
      logger.error('Failed to toggle theme', error as Error);
    }
  }

  private async updateThemeButton(): Promise<void> {
    try {
      const config = await ThemeManager.getThemeConfig();
      const themeText = this.elements['theme-text'];
      const themeIcon = this.elements['theme-toggle']?.querySelector('.btn-icon');

      if (themeText) {
        // Show current theme mode
        if (config.followSystem || config.mode === 'system') {
          themeText.textContent = 'System';
        } else if (config.mode === 'light') {
          themeText.textContent = 'Light';
        } else {
          themeText.textContent = 'Dark';
        }
      }

      if (themeIcon) {
        // Show icon for current theme
        if (config.followSystem || config.mode === 'system') {
          themeIcon.textContent = '↻';
        } else if (config.mode === 'light') {
          themeIcon.textContent = '☀';
        } else {
          themeIcon.textContent = '☽';
        }
      }
    } catch (error) {
      logger.error('Failed to update theme button', error as Error);
    }
  }

  private async loadCurrentPageInfo(): Promise<void> {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const activeTab = tabs[0];

      if (activeTab) {
        this.updatePageInfo(activeTab.title || 'Untitled', activeTab.url || '');
      }
    } catch (error) {
      logger.error('Failed to load current page info', error as Error);
      this.updatePageInfo('Error loading page info', '');
    }
  }

  private async updatePageInfo(title: string, url: string): Promise<void> {
    if (this.elements['page-title']) {
      this.elements['page-title'].textContent = title;
      this.elements['page-title'].title = title;
    }

    if (this.elements['page-url']) {
      this.elements['page-url'].textContent = this.shortenUrl(url);
      this.elements['page-url'].title = url;
    }

    // Check for existing note and show indicator
    await this.checkForExistingNote(url);
  }

  private async checkForExistingNote(url: string): Promise<void> {
    try {
      logger.info('Starting check for existing note', { url });

      // Only check if we have a valid URL
      if (!url || url.startsWith('chrome://') || url.startsWith('about:')) {
        logger.debug('Skipping check - invalid URL', { url });
        this.hideAlreadyClippedIndicator();
        return;
      }

      logger.debug('Sending CHECK_EXISTING_NOTE message to background', { url });

      // Send message to background to check for existing note
      const response = await MessageUtils.sendMessage({
        type: 'CHECK_EXISTING_NOTE',
        url
      }) as { exists: boolean; noteId?: string };

      logger.info('Received response from background', { response });

      if (response && response.exists && response.noteId) {
        logger.info('Note exists - showing indicator', { noteId: response.noteId });
        this.showAlreadyClippedIndicator(response.noteId);
      } else {
        logger.debug('Note does not exist - hiding indicator', { response });
        this.hideAlreadyClippedIndicator();
      }
    } catch (error) {
      logger.error('Failed to check for existing note', error as Error);
      this.hideAlreadyClippedIndicator();
    }
  }

  private showAlreadyClippedIndicator(noteId: string): void {
    logger.info('Showing already-clipped indicator', { noteId });

    const indicator = document.getElementById('already-clipped');
    const openLink = document.getElementById('open-note-link') as HTMLAnchorElement;

    logger.debug('Indicator element found', {
      indicatorExists: !!indicator,
      linkExists: !!openLink
    });

    if (indicator) {
      indicator.classList.remove('hidden');
      logger.debug('Removed hidden class from indicator');
    } else {
      logger.error('Could not find already-clipped element in DOM!');
    }

    if (openLink) {
      openLink.onclick = (e: MouseEvent) => {
        e.preventDefault();
        this.handleOpenNoteInTrilium(noteId);
      };
    }
  }

  private hideAlreadyClippedIndicator(): void {
    const indicator = document.getElementById('already-clipped');
    if (indicator) {
      indicator.classList.add('hidden');
    }
  }

  private async handleOpenNoteInTrilium(noteId: string): Promise<void> {
    try {
      logger.info('Opening note in Trilium', { noteId });

      await MessageUtils.sendMessage({
        type: 'OPEN_NOTE',
        noteId
      });

      // Close popup after opening note
      window.close();
    } catch (error) {
      logger.error('Failed to open note in Trilium', error as Error);
      this.showError('Failed to open note in Trilium');
    }
  }

  private shortenUrl(url: string): string {
    if (url.length <= 50) return url;

    try {
      const urlObj = new URL(url);
      return `${urlObj.hostname}${urlObj.pathname.substring(0, 20)}...`;
    } catch {
      return url.substring(0, 50) + '...';
    }
  }

  private async checkTriliumConnection(): Promise<void> {
    try {
      // Get saved connection settings
      // We don't need to check individual settings anymore since the background service handles this

      // Get current connection status from background service
      const statusResponse = await MessageUtils.sendMessage({
        type: 'GET_CONNECTION_STATUS'
      }) as any;

      const status = statusResponse?.status || 'not-found';

      if (status === 'found-desktop' || status === 'found-server') {
        const connectionType = status === 'found-desktop' ? 'Desktop Client' : 'Server';
        const url = statusResponse?.url || 'Unknown';
        this.updateConnectionStatus('connected', `Connected to ${connectionType}`);
        this.updatePersistentStatus('connected', `${connectionType}: ${url}`);
      } else if (status === 'searching') {
        this.updateConnectionStatus('checking', 'Checking connections...');
        this.updatePersistentStatus('testing', 'Searching for Trilium...');
      } else {
        this.updateConnectionStatus('disconnected', 'No active connections');
        this.updatePersistentStatus('disconnected', 'No connections available');
      }

    } catch (error) {
      logger.error('Failed to check Trilium connection', error as Error);
      this.updateConnectionStatus('disconnected', 'Connection check failed');
      this.updatePersistentStatus('disconnected', 'Connection check failed');
    }
  }

  private updateConnectionStatus(status: 'connected' | 'disconnected' | 'checking' | 'testing', message: string): void {
    const statusElement = this.elements['connection-status'];
    const textElement = this.elements['connection-text'];

    if (statusElement && textElement) {
      statusElement.setAttribute('data-status', status);
      textElement.textContent = message;
    }
  }

  private showProgress(message: string): void {
    this.showStatus(message, 'info');
    this.elements['progress-bar']?.classList.remove('hidden');
  }

  private showSuccess(message: string): void {
    this.showStatus(message, 'success');
    this.elements['progress-bar']?.classList.add('hidden');

    // Auto-hide after 3 seconds
    setTimeout(() => {
      this.hideStatus();
    }, 3000);
  }

  private showError(message: string): void {
    this.showStatus(message, 'error');
    this.elements['progress-bar']?.classList.add('hidden');
  }

  private showStatus(message: string, type: 'info' | 'success' | 'error'): void {
    const statusElement = this.elements['status-message'];
    const textElement = this.elements['status-text'];

    if (statusElement && textElement) {
      statusElement.className = `status-message status-message--${type}`;
      textElement.textContent = message;
      statusElement.classList.remove('hidden');
    }
  }

  private hideStatus(): void {
    this.elements['status-message']?.classList.add('hidden');
    this.elements['progress-bar']?.classList.add('hidden');
  }
}

// Initialize the popup when DOM is loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new PopupController());
} else {
  new PopupController();
}
