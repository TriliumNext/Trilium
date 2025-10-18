import { Logger } from '@/shared/utils';
import { ExtensionConfig } from '@/shared/types';
import { ThemeManager, ThemeMode } from '@/shared/theme';

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
  }

  private async loadCurrentSettings(): Promise<void> {
    try {
      const config = await chrome.storage.sync.get();

      // Populate form fields with current settings
      const triliumUrl = document.getElementById('trilium-url') as HTMLInputElement;
      const defaultTitle = document.getElementById('default-title') as HTMLInputElement;
      const autoSave = document.getElementById('auto-save') as HTMLInputElement;
      const enableToasts = document.getElementById('enable-toasts') as HTMLInputElement;
      const screenshotFormat = document.getElementById('screenshot-format') as HTMLSelectElement;

      if (triliumUrl) triliumUrl.value = config.triliumServerUrl || '';
      if (defaultTitle) defaultTitle.value = config.defaultNoteTitle || 'Web Clip - {title}';
      if (autoSave) autoSave.checked = config.autoSave || false;
      if (enableToasts) enableToasts.checked = config.enableToasts !== false; // default true
      if (screenshotFormat) screenshotFormat.value = config.screenshotFormat || 'png';

      // Load content format preference (default to 'html')
      const contentFormat = config.contentFormat || 'html';
      const formatRadio = document.querySelector(`input[name="contentFormat"][value="${contentFormat}"]`) as HTMLInputElement;
      if (formatRadio) {
        formatRadio.checked = true;
      }

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

      const config: Partial<ExtensionConfig> = {
        triliumServerUrl: (document.getElementById('trilium-url') as HTMLInputElement).value.trim(),
        defaultNoteTitle: (document.getElementById('default-title') as HTMLInputElement).value.trim(),
        autoSave: (document.getElementById('auto-save') as HTMLInputElement).checked,
        enableToasts: (document.getElementById('enable-toasts') as HTMLInputElement).checked,
        screenshotFormat: (document.getElementById('screenshot-format') as HTMLSelectElement).value as 'png' | 'jpeg',
        screenshotQuality: 0.9
      };

      // Validate settings
      if (config.triliumServerUrl && !this.isValidUrl(config.triliumServerUrl)) {
        throw new Error('Please enter a valid Trilium server URL');
      }

      if (!config.defaultNoteTitle) {
        throw new Error('Please enter a default note title template');
      }

      // Save to storage (including content format)
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
}

// Initialize the options controller when DOM is loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new OptionsController());
} else {
  new OptionsController();
}
