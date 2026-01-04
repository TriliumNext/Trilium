import { Logger, BrowserDetect } from '@/shared/utils';
import { ExtensionConfig } from '@/shared/types';
import { ThemeManager, ThemeMode } from '@/shared/theme';
import { DateFormatter, DATE_TIME_PRESETS } from '@/shared/date-formatter';

const logger = Logger.create('Options', 'options');

/**
 * Options page controller for the Trilium Web Clipper extension
 * Handles configuration management and settings UI
 */
class OptionsController {
  private form: HTMLFormElement;
  private statusElement: HTMLElement;

  constructor() {
    this.form = document.getElementById('options-form') as HTMLFormElement;
    this.statusElement = document.getElementById('status') as HTMLElement;

    this.initialize();
  }

  private async initialize(): Promise<void> {
    try {
      logger.info('Initializing options page...');

      await this.initializeTheme();
      await this.loadCurrentSettings();
      await this.initializeShortcuts();
      this.setupEventHandlers();

      logger.info('Options page initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize options page', error as Error);
      this.showStatus('Failed to initialize options page', 'error');
    }
  }

  private setupEventHandlers(): void {
    this.form.addEventListener('submit', this.handleSave.bind(this));

    const testButton = document.getElementById('test-connection');
    testButton?.addEventListener('click', this.handleTestConnection.bind(this));

    const viewLogsButton = document.getElementById('view-logs');
    viewLogsButton?.addEventListener('click', this.handleViewLogs.bind(this));

    // Theme radio buttons
    const themeRadios = document.querySelectorAll('input[name="theme"]');
    themeRadios.forEach(radio => {
      radio.addEventListener('change', this.handleThemeChange.bind(this));
    });

    // Date/time format radio buttons
    const formatTypeRadios = document.querySelectorAll('input[name="dateTimeFormat"]');
    formatTypeRadios.forEach(radio => {
      radio.addEventListener('change', this.handleFormatTypeChange.bind(this));
    });

    // Date/time preset selector
    const presetSelector = document.getElementById('datetime-preset') as HTMLSelectElement;
    presetSelector?.addEventListener('change', this.updateFormatPreview.bind(this));

    // Custom format input
    const customFormatInput = document.getElementById('datetime-custom') as HTMLInputElement;
    customFormatInput?.addEventListener('input', this.updateFormatPreview.bind(this));

    // Format help toggle
    const helpToggle = document.getElementById('format-help-toggle');
    helpToggle?.addEventListener('click', this.toggleFormatHelp.bind(this));

    // Toast duration slider
    const toastDurationSlider = document.getElementById('toast-duration') as HTMLInputElement;
    toastDurationSlider?.addEventListener('input', this.updateToastDurationDisplay.bind(this));

    // Open browser shortcuts settings
    const openShortcutsBtn = document.getElementById('open-shortcuts-settings');
    openShortcutsBtn?.addEventListener('click', this.handleOpenShortcutsSettings.bind(this));
  }

  private async initializeShortcuts(): Promise<void> {
    try {
      logger.debug('Initializing shortcuts UI...');
      await this.loadShortcuts();
      this.updateShortcutsHelpText();
      logger.debug('Shortcuts UI initialized');
    } catch (error) {
      logger.error('Failed to initialize shortcuts UI', error as Error);
    }
  }

  private updateShortcutsHelpText(): void {
    const helpText = document.getElementById('shortcuts-help-text');
    const button = document.getElementById('open-shortcuts-settings');
    const browser = BrowserDetect.getBrowser();
    const browserName = BrowserDetect.getBrowserName();

    if (helpText) {
      helpText.textContent = BrowserDetect.getShortcutsInstructions();
    }

    // Update button text for Firefox since it can't open directly
    if (button && browser === 'firefox') {
      button.textContent = '📖 Show Instructions';
    } else if (button) {
      button.textContent = `⚙ Configure Shortcuts in ${browserName}`;
    }
  }

  private async loadShortcuts(): Promise<void> {
    try {
      const commands = await chrome.commands.getAll();

      const mapByName: Record<string, chrome.commands.Command> = {};
      commands.forEach(c => { if (c.name) mapByName[c.name] = c; });

      const names = ['save-selection', 'save-page', 'save-screenshot', 'save-tabs'];
      names.forEach(name => {
        const kbd = document.getElementById(`shortcut-${name}`);
        const cmd = mapByName[name];
        if (kbd) {
          kbd.textContent = cmd?.shortcut || 'Not set';
          kbd.classList.toggle('not-set', !cmd?.shortcut);
        }
      });

      logger.debug('Loaded shortcuts', { commands });
    } catch (error) {
      logger.error('Failed to load shortcuts', error as Error);
    }
  }

  private handleOpenShortcutsSettings(): void {
    const browser = BrowserDetect.getBrowser();
    const shortcutsUrl = BrowserDetect.getShortcutsUrl();
    const browserName = BrowserDetect.getBrowserName();

    logger.info('Opening shortcuts settings', { browser, shortcutsUrl });

    if (shortcutsUrl) {
      // Chromium-based browsers support direct URL navigation
      try {
        chrome.tabs.create({ url: shortcutsUrl });
        logger.info('Opened browser shortcuts settings', { browser, url: shortcutsUrl });
      } catch (error) {
        logger.error('Failed to open shortcuts settings', error as Error);
        this.showStatus(`Could not open shortcuts settings. Navigate to ${shortcutsUrl} manually.`, 'warning');
      }
    } else if (browser === 'firefox') {
      // Firefox doesn't allow opening about: URLs, show instructions instead
      this.showStatus(
        'Firefox: Open Menu (☰) → Add-ons and themes → Extensions → Click the gear icon (⚙️) → Manage Extension Shortcuts',
        'info'
      );
      logger.info('Displayed Firefox shortcut instructions');
    } else {
      // Unknown browser - provide generic guidance
      this.showStatus(
        `Please check ${browserName}'s extension settings to configure keyboard shortcuts.`,
        'info'
      );
      logger.warn('Unknown browser, cannot open shortcuts settings', { browser });
    }
  }

  private async loadCurrentSettings(): Promise<void> {
    try {
      const config = await chrome.storage.sync.get();

      // Populate form fields with current settings
      const triliumUrl = document.getElementById('trilium-url') as HTMLInputElement;
      const defaultTitle = document.getElementById('default-title') as HTMLInputElement;
      const autoSave = document.getElementById('auto-save') as HTMLInputElement;
      const enableToasts = document.getElementById('enable-toasts') as HTMLInputElement;
      const toastDuration = document.getElementById('toast-duration') as HTMLInputElement;
      const enableMetaNotePrompt = document.getElementById('enable-meta-note-prompt') as HTMLInputElement;
      const screenshotFormat = document.getElementById('screenshot-format') as HTMLSelectElement;

      if (triliumUrl) triliumUrl.value = config.triliumServerUrl || '';
      if (defaultTitle) defaultTitle.value = config.defaultNoteTitle || 'Web Clip - {title}';
      if (autoSave) autoSave.checked = config.autoSave || false;
      if (enableToasts) enableToasts.checked = config.enableToasts !== false; // default true
      if (toastDuration) {
        toastDuration.value = String(config.toastDuration || 3000);
        this.updateToastDurationDisplay();
      }
      if (enableMetaNotePrompt) enableMetaNotePrompt.checked = config.enableMetaNotePrompt || false;
      if (screenshotFormat) screenshotFormat.value = config.screenshotFormat || 'png';

      // Load content format preference (default to 'html')
      const contentFormat = config.contentFormat || 'html';
      const formatRadio = document.querySelector(`input[name="contentFormat"][value="${contentFormat}"]`) as HTMLInputElement;
      if (formatRadio) {
        formatRadio.checked = true;
      }

      // Load date/time format settings
      const dateTimeFormat = config.dateTimeFormat || 'preset';
      const dateTimeFormatRadio = document.querySelector(`input[name="dateTimeFormat"][value="${dateTimeFormat}"]`) as HTMLInputElement;
      if (dateTimeFormatRadio) {
        dateTimeFormatRadio.checked = true;
      }

      const dateTimePreset = config.dateTimePreset || 'iso';
      const presetSelector = document.getElementById('datetime-preset') as HTMLSelectElement;
      if (presetSelector) {
        presetSelector.value = dateTimePreset;
      }

      const dateTimeCustomFormat = config.dateTimeCustomFormat || 'YYYY-MM-DD HH:mm:ss';
      const customFormatInput = document.getElementById('datetime-custom') as HTMLInputElement;
      if (customFormatInput) {
        customFormatInput.value = dateTimeCustomFormat;
      }

      // Show/hide format containers based on selection
      this.updateFormatContainerVisibility(dateTimeFormat);

      // Update format preview
      this.updateFormatPreview();

      logger.debug('Settings loaded', { config });
    } catch (error) {
      logger.error('Failed to load settings', error as Error);
      this.showStatus('Failed to load current settings', 'error');
    }
  }

  private async handleSave(event: Event): Promise<void> {
    event.preventDefault();

    try {
      logger.info('Saving settings...');

      // Get content format selection
      const contentFormatRadio = document.querySelector('input[name="contentFormat"]:checked') as HTMLInputElement;
      const contentFormat = contentFormatRadio?.value || 'html';

      // Get date/time format settings
      const dateTimeFormatRadio = document.querySelector('input[name="dateTimeFormat"]:checked') as HTMLInputElement;
      const dateTimeFormat = dateTimeFormatRadio?.value || 'preset';

      const dateTimePreset = (document.getElementById('datetime-preset') as HTMLSelectElement)?.value || 'iso';
      const dateTimeCustomFormat = (document.getElementById('datetime-custom') as HTMLInputElement)?.value || 'YYYY-MM-DD';

      const config: Partial<ExtensionConfig> = {
        triliumServerUrl: (document.getElementById('trilium-url') as HTMLInputElement).value.trim(),
        defaultNoteTitle: (document.getElementById('default-title') as HTMLInputElement).value.trim(),
        autoSave: (document.getElementById('auto-save') as HTMLInputElement).checked,
        enableToasts: (document.getElementById('enable-toasts') as HTMLInputElement).checked,
        toastDuration: parseInt((document.getElementById('toast-duration') as HTMLInputElement).value, 10) || 3000,
        enableMetaNotePrompt: (document.getElementById('enable-meta-note-prompt') as HTMLInputElement).checked,
        screenshotFormat: (document.getElementById('screenshot-format') as HTMLSelectElement).value as 'png' | 'jpeg',
        screenshotQuality: 0.9,
        dateTimeFormat: dateTimeFormat as 'preset' | 'custom',
        dateTimePreset,
        dateTimeCustomFormat
      };

      // Validate settings
      if (config.triliumServerUrl && !this.isValidUrl(config.triliumServerUrl)) {
        throw new Error('Please enter a valid Trilium server URL');
      }

      if (!config.defaultNoteTitle) {
        throw new Error('Please enter a default note title template');
      }

      // Validate custom format if selected
      if (dateTimeFormat === 'custom' && dateTimeCustomFormat) {
        if (!DateFormatter.isValidFormat(dateTimeCustomFormat)) {
          throw new Error('Invalid custom date format. Please check the format tokens.');
        }
      }

      // Save to storage (including content format and date settings)
      await chrome.storage.sync.set({ ...config, contentFormat });

      this.showStatus('Settings saved successfully!', 'success');
      logger.info('Settings saved successfully', { config, contentFormat });

    } catch (error) {
      logger.error('Failed to save settings', error as Error);
      this.showStatus(`Failed to save settings: ${(error as Error).message}`, 'error');
    }
  }

  private async handleTestConnection(): Promise<void> {
    try {
      logger.info('Testing Trilium connection...');
      this.showStatus('Testing connection...', 'info');
      this.updateConnectionStatus('checking', 'Testing connection...');

      const triliumUrl = (document.getElementById('trilium-url') as HTMLInputElement).value.trim();

      if (!triliumUrl) {
        throw new Error('Please enter a Trilium server URL first');
      }

      if (!this.isValidUrl(triliumUrl)) {
        throw new Error('Please enter a valid URL (e.g., http://localhost:8080)');
      }

      // Test connection to Trilium
      const testUrl = `${triliumUrl.replace(/\/$/, '')}/api/app-info`;
      const response = await fetch(testUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Connection failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      if (data.appName && data.appName.toLowerCase().includes('trilium')) {
        this.updateConnectionStatus('connected', `Connected to ${data.appName}`);
        this.showStatus(`Successfully connected to ${data.appName} (${data.appVersion || 'unknown version'})`, 'success');
        logger.info('Connection test successful', { data });
      } else {
        this.updateConnectionStatus('connected', 'Connected (Unknown service)');
        this.showStatus('Connected, but server may not be Trilium', 'warning');
        logger.warn('Connected but unexpected response', { data });
      }

    } catch (error) {
      logger.error('Connection test failed', error as Error);

      this.updateConnectionStatus('disconnected', 'Connection failed');

      if (error instanceof TypeError && error.message.includes('fetch')) {
        this.showStatus('Connection failed: Cannot reach server. Check URL and ensure Trilium is running.', 'error');
      } else {
        this.showStatus(`Connection failed: ${(error as Error).message}`, 'error');
      }
    }
  }

  private isValidUrl(url: string): boolean {
    try {
      const urlObj = new URL(url);
      return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
    } catch {
      return false;
    }
  }

  private showStatus(message: string, type: 'success' | 'error' | 'info' | 'warning'): void {
    this.statusElement.textContent = message;
    this.statusElement.className = `status-message ${type}`;
    this.statusElement.style.display = 'block';

    // Auto-hide success messages after 5 seconds
    if (type === 'success') {
      setTimeout(() => {
        this.statusElement.style.display = 'none';
      }, 5000);
    }
  }

  private updateConnectionStatus(status: 'connected' | 'disconnected' | 'checking', text: string): void {
    const connectionStatus = document.getElementById('connection-status');
    const connectionText = document.getElementById('connection-text');

    if (connectionStatus && connectionText) {
      connectionStatus.className = `connection-indicator ${status}`;
      connectionText.textContent = text;
    }
  }

  private handleViewLogs(): void {
    // Open the log viewer in a new tab
    chrome.tabs.create({
      url: chrome.runtime.getURL('logs.html')
    });
  }

  private async initializeTheme(): Promise<void> {
    try {
      await ThemeManager.initialize();
      await this.loadThemeSettings();
    } catch (error) {
      logger.error('Failed to initialize theme', error as Error);
    }
  }

  private async loadThemeSettings(): Promise<void> {
    try {
      const config = await ThemeManager.getThemeConfig();
      const themeRadios = document.querySelectorAll('input[name="theme"]') as NodeListOf<HTMLInputElement>;

      themeRadios.forEach(radio => {
        if (config.followSystem || config.mode === 'system') {
          radio.checked = radio.value === 'system';
        } else {
          radio.checked = radio.value === config.mode;
        }

        // Update active class
        const themeOption = radio.closest('.theme-option');
        if (themeOption) {
          themeOption.classList.toggle('active', radio.checked);
        }
      });
    } catch (error) {
      logger.error('Failed to load theme settings', error as Error);
    }
  }

  private async handleThemeChange(event: Event): Promise<void> {
    try {
      const radio = event.target as HTMLInputElement;
      const selectedTheme = radio.value as ThemeMode;

      logger.info('Theme change requested', { theme: selectedTheme });

      // Update theme configuration
      if (selectedTheme === 'system') {
        await ThemeManager.setThemeConfig({
          mode: 'system',
          followSystem: true
        });
      } else {
        await ThemeManager.setThemeConfig({
          mode: selectedTheme,
          followSystem: false
        });
      }

      // Update active classes
      const themeOptions = document.querySelectorAll('.theme-option');
      themeOptions.forEach(option => {
        const input = option.querySelector('input[type="radio"]') as HTMLInputElement;
        option.classList.toggle('active', input.checked);
      });

      this.showStatus('Theme updated successfully!', 'success');
    } catch (error) {
      logger.error('Failed to change theme', error as Error);
      this.showStatus('Failed to update theme', 'error');
    }
  }

  private handleFormatTypeChange(event: Event): void {
    const radio = event.target as HTMLInputElement;
    const formatType = radio.value as 'preset' | 'custom';

    this.updateFormatContainerVisibility(formatType);
    this.updateFormatPreview();
  }

  private updateFormatContainerVisibility(formatType: string): void {
    const presetContainer = document.getElementById('preset-format-container');
    const customContainer = document.getElementById('custom-format-container');

    if (presetContainer && customContainer) {
      if (formatType === 'preset') {
        presetContainer.style.display = 'block';
        customContainer.style.display = 'none';
      } else {
        presetContainer.style.display = 'none';
        customContainer.style.display = 'block';
      }
    }
  }

  private updateFormatPreview(): void {
    try {
      const formatTypeRadio = document.querySelector('input[name="dateTimeFormat"]:checked') as HTMLInputElement;
      const formatType = formatTypeRadio?.value || 'preset';

      let formatString = 'YYYY-MM-DD';

      if (formatType === 'preset') {
        const presetSelector = document.getElementById('datetime-preset') as HTMLSelectElement;
        const presetId = presetSelector?.value || 'iso';
        const preset = DATE_TIME_PRESETS.find(p => p.id === presetId);
        formatString = preset?.format || 'YYYY-MM-DD';
      } else {
        const customInput = document.getElementById('datetime-custom') as HTMLInputElement;
        formatString = customInput?.value || 'YYYY-MM-DD';
      }

      // Generate preview with current date/time
      const previewDate = new Date();
      const formattedDate = DateFormatter.format(previewDate, formatString);

      const previewElement = document.getElementById('format-preview-text');
      if (previewElement) {
        previewElement.textContent = formattedDate;
      }

      logger.debug('Format preview updated', { formatString, formattedDate });
    } catch (error) {
      logger.error('Failed to update format preview', error as Error);
      const previewElement = document.getElementById('format-preview-text');
      if (previewElement) {
        previewElement.textContent = 'Invalid format';
        previewElement.style.color = 'var(--color-error-text)';
      }
    }
  }

  private toggleFormatHelp(): void {
    const cheatsheet = document.getElementById('format-cheatsheet');
    if (cheatsheet) {
      const isVisible = cheatsheet.style.display !== 'none';
      cheatsheet.style.display = isVisible ? 'none' : 'block';

      const button = document.getElementById('format-help-toggle');
      if (button) {
        button.textContent = isVisible ? '? Format Guide' : '✕ Close Guide';
      }
    }
  }

  private updateToastDurationDisplay(): void {
    const slider = document.getElementById('toast-duration') as HTMLInputElement;
    const valueDisplay = document.getElementById('toast-duration-value');

    if (slider && valueDisplay) {
      const milliseconds = parseInt(slider.value, 10);
      const seconds = (milliseconds / 1000).toFixed(1);
      valueDisplay.textContent = `${seconds}s`;
    }
  }
}

// Initialize the options controller when DOM is loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new OptionsController());
} else {
  new OptionsController();
}
