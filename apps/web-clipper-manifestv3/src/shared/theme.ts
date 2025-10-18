/**
 * Theme management system for the extension
 * Supports light, dark, and system (auto) themes
 */

export type ThemeMode = 'light' | 'dark' | 'system';

export interface ThemeConfig {
  mode: ThemeMode;
  followSystem: boolean;
}

/**
 * Theme Manager - Handles theme switching and persistence
 */
export class ThemeManager {
  private static readonly STORAGE_KEY = 'theme_config';
  private static readonly DEFAULT_CONFIG: ThemeConfig = {
    mode: 'system',
    followSystem: true,
  };

  private static listeners: Array<(theme: 'light' | 'dark') => void> = [];
  private static mediaQuery: MediaQueryList | null = null;

  /**
   * Initialize the theme system
   */
  static async initialize(): Promise<void> {
    const config = await this.getThemeConfig();
    await this.applyTheme(config);
    this.setupSystemThemeListener();
  }

  /**
   * Get current theme configuration
   */
  static async getThemeConfig(): Promise<ThemeConfig> {
    try {
      const result = await chrome.storage.sync.get(this.STORAGE_KEY);
      return { ...this.DEFAULT_CONFIG, ...result[this.STORAGE_KEY] };
    } catch (error) {
      console.warn('Failed to load theme config, using defaults:', error);
      return this.DEFAULT_CONFIG;
    }
  }

  /**
   * Set theme configuration
   */
  static async setThemeConfig(config: Partial<ThemeConfig>): Promise<void> {
    try {
      const currentConfig = await this.getThemeConfig();
      const newConfig = { ...currentConfig, ...config };

      await chrome.storage.sync.set({ [this.STORAGE_KEY]: newConfig });
      await this.applyTheme(newConfig);
    } catch (error) {
      console.error('Failed to save theme config:', error);
      throw error;
    }
  }

  /**
   * Apply theme to the current page
   */
  static async applyTheme(config: ThemeConfig): Promise<void> {
    const effectiveTheme = this.getEffectiveTheme(config);

    // Apply theme to document
    this.applyThemeToDocument(effectiveTheme);

    // Notify listeners
    this.notifyListeners(effectiveTheme);
  }

  /**
   * Get the effective theme (resolves 'system' to 'light' or 'dark')
   */
  static getEffectiveTheme(config: ThemeConfig): 'light' | 'dark' {
    if (config.mode === 'system' || config.followSystem) {
      return this.getSystemTheme();
    }
    return config.mode === 'dark' ? 'dark' : 'light';
  }

  /**
   * Get system theme preference
   */
  static getSystemTheme(): 'light' | 'dark' {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'light'; // Default fallback
  }

  /**
   * Apply theme classes to document
   */
  static applyThemeToDocument(theme: 'light' | 'dark'): void {
    const html = document.documentElement;

    // Remove existing theme classes
    html.classList.remove('theme-light', 'theme-dark');

    // Add current theme class
    html.classList.add(`theme-${theme}`);

    // Set data attribute for CSS targeting
    html.setAttribute('data-theme', theme);
  }

  /**
   * Toggle between light, dark, and system themes
   */
  static async toggleTheme(): Promise<void> {
    const config = await this.getThemeConfig();

    let newMode: ThemeMode;
    let followSystem: boolean;

    if (config.followSystem || config.mode === 'system') {
      // System -> Light
      newMode = 'light';
      followSystem = false;
    } else if (config.mode === 'light') {
      // Light -> Dark
      newMode = 'dark';
      followSystem = false;
    } else {
      // Dark -> System
      newMode = 'system';
      followSystem = true;
    }

    await this.setThemeConfig({
      mode: newMode,
      followSystem
    });
  }

  /**
   * Set to follow system theme
   */
  static async followSystem(): Promise<void> {
    await this.setThemeConfig({
      mode: 'system',
      followSystem: true
    });
  }

  /**
   * Setup system theme change listener
   */
  private static setupSystemThemeListener(): void {
    if (typeof window === 'undefined' || !window.matchMedia) {
      return;
    }

    this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handleSystemThemeChange = async (): Promise<void> => {
      const config = await this.getThemeConfig();
      if (config.followSystem || config.mode === 'system') {
        await this.applyTheme(config);
      }
    };

    // Modern browsers
    if (this.mediaQuery.addEventListener) {
      this.mediaQuery.addEventListener('change', handleSystemThemeChange);
    } else {
      // Fallback for older browsers
      this.mediaQuery.addListener(handleSystemThemeChange);
    }
  }

  /**
   * Add theme change listener
   */
  static addThemeListener(callback: (theme: 'light' | 'dark') => void): () => void {
    this.listeners.push(callback);

    // Return unsubscribe function
    return () => {
      const index = this.listeners.indexOf(callback);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  /**
   * Notify all listeners of theme change
   */
  private static notifyListeners(theme: 'light' | 'dark'): void {
    this.listeners.forEach(callback => {
      try {
        callback(theme);
      } catch (error) {
        console.error('Theme listener error:', error);
      }
    });
  }

  /**
   * Get current effective theme without config lookup
   */
  static getCurrentTheme(): 'light' | 'dark' {
    const html = document.documentElement;
    return html.classList.contains('theme-dark') ? 'dark' : 'light';
  }

  /**
   * Create theme toggle button
   */
  static createThemeToggle(): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = 'theme-toggle';
    button.title = 'Toggle theme';
    button.setAttribute('aria-label', 'Toggle between light and dark theme');

    const updateButton = (theme: 'light' | 'dark') => {
      button.innerHTML = theme === 'dark'
        ? '<span class="theme-icon">☀</span>'
        : '<span class="theme-icon">☽</span>';
    };    // Set initial state
    updateButton(this.getCurrentTheme());

    // Add click handler
    button.addEventListener('click', () => this.toggleTheme());

    // Listen for theme changes
    this.addThemeListener(updateButton);

    return button;
  }
}
