import { Logger } from '@/shared/utils';
import { ThemeManager } from '@/shared/theme';

const logger = Logger.create('DuplicateDialog', 'content');

/**
 * Duplicate Note Dialog
 * Shows a modal dialog asking the user what to do when saving content from a URL that already has a note
 */
export class DuplicateDialog {
  private dialog: HTMLElement | null = null;
  private overlay: HTMLElement | null = null;
  private resolvePromise: ((value: { action: 'append' | 'new' | 'cancel' }) => void) | null = null;

  /**
   * Show the duplicate dialog and wait for user choice
   */
  public async show(existingNoteId: string, url: string): Promise<{ action: 'append' | 'new' | 'cancel' }> {
    logger.info('Showing duplicate dialog', { existingNoteId, url });

    return new Promise((resolve) => {
      this.resolvePromise = resolve;
      this.createDialog(existingNoteId, url);
    });
  }

  private async createDialog(existingNoteId: string, url: string): Promise<void> {
    // Detect current theme
    const config = await ThemeManager.getThemeConfig();
    const effectiveTheme = ThemeManager.getEffectiveTheme(config);
    const isDark = effectiveTheme === 'dark';

    // Theme colors
    const colors = {
      overlay: isDark ? 'rgba(0, 0, 0, 0.75)' : 'rgba(0, 0, 0, 0.6)',
      dialogBg: isDark ? '#2a2a2a' : '#ffffff',
      textPrimary: isDark ? '#e8e8e8' : '#1a1a1a',
      textSecondary: isDark ? '#a0a0a0' : '#666666',
      border: isDark ? '#404040' : '#e0e0e0',
      iconBg: isDark ? '#404040' : '#f0f0f0',
      buttonPrimary: '#0066cc',
      buttonPrimaryHover: '#0052a3',
      buttonSecondaryBg: isDark ? '#3a3a3a' : '#ffffff',
      buttonSecondaryBorder: isDark ? '#555555' : '#e0e0e0',
      buttonSecondaryBorderHover: '#0066cc',
      buttonSecondaryHoverBg: isDark ? '#454545' : '#f5f5f5',
    };

    // Create overlay - more opaque background
    this.overlay = document.createElement('div');
    this.overlay.id = 'trilium-clipper-overlay';
    this.overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: ${colors.overlay};
      z-index: 2147483646;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    `;

    // Create dialog - fully opaque (explicitly set opacity to prevent inheritance)
    this.dialog = document.createElement('div');
    this.dialog.id = 'trilium-clipper-dialog';
    this.dialog.style.cssText = `
      background: ${colors.dialogBg};
      opacity: 1;
      border-radius: 12px;
      box-shadow: 0 20px 60px ${isDark ? 'rgba(0, 0, 0, 0.5)' : 'rgba(0, 0, 0, 0.3)'};
      padding: 24px;
      max-width: 480px;
      width: 90%;
      z-index: 2147483647;
    `;

    const hostname = new URL(url).hostname;

    this.dialog.innerHTML = `
      <div style="margin-bottom: 20px;">
        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
          <div style="width: 40px; height: 40px; background: ${colors.iconBg}; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 20px;">
            ℹ️
          </div>
          <h2 style="margin: 0; font-size: 20px; font-weight: 600; color: ${colors.textPrimary};">
            Already Saved
          </h2>
        </div>
        <p style="margin: 0; color: ${colors.textSecondary}; font-size: 14px; line-height: 1.6;">
          You've already saved content from <strong style="color: ${colors.textPrimary};">${hostname}</strong> to Trilium.<br><br>
          <span style="color: ${colors.textPrimary};">This new content will be added to your existing note.</span>
        </p>
      </div>

      <div style="display: flex; flex-direction: column; gap: 12px; margin-bottom: 20px;">
        <button id="trilium-dialog-proceed" style="
          padding: 14px 20px;
          border: 2px solid ${colors.buttonPrimary};
          background: ${colors.buttonPrimary};
          color: white;
          border-radius: 8px;
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
        ">
          Proceed & Add Content
        </button>

        <button id="trilium-dialog-cancel" style="
          padding: 12px 20px;
          border: 2px solid ${colors.buttonSecondaryBorder};
          background: ${colors.buttonSecondaryBg};
          color: ${colors.textPrimary};
          border-radius: 8px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        ">
          Cancel
        </button>
      </div>

      <div style="display: flex; justify-content: space-between; align-items: center; padding-top: 12px; border-top: 1px solid ${colors.border};">
        <a id="trilium-dialog-view" href="#" style="
          color: ${colors.buttonPrimary};
          text-decoration: none;
          font-size: 13px;
          font-weight: 500;
        ">
          View existing note →
        </a>
        <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; color: ${colors.textSecondary}; cursor: pointer;">
          <input type="checkbox" id="trilium-dialog-dont-ask" style="cursor: pointer;">
          Don't ask again
        </label>
      </div>
    `;

    // Add hover effects via event listeners
    const proceedBtn = this.dialog.querySelector('#trilium-dialog-proceed') as HTMLButtonElement;
    const cancelBtn = this.dialog.querySelector('#trilium-dialog-cancel') as HTMLButtonElement;
    const viewLink = this.dialog.querySelector('#trilium-dialog-view') as HTMLAnchorElement;
    const dontAskCheckbox = this.dialog.querySelector('#trilium-dialog-dont-ask') as HTMLInputElement;

    proceedBtn.addEventListener('mouseenter', () => {
      proceedBtn.style.background = colors.buttonPrimaryHover;
    });
    proceedBtn.addEventListener('mouseleave', () => {
      proceedBtn.style.background = colors.buttonPrimary;
    });

    cancelBtn.addEventListener('mouseenter', () => {
      cancelBtn.style.background = colors.buttonSecondaryHoverBg;
      cancelBtn.style.borderColor = colors.buttonSecondaryBorderHover;
    });
    cancelBtn.addEventListener('mouseleave', () => {
      cancelBtn.style.background = colors.buttonSecondaryBg;
      cancelBtn.style.borderColor = colors.buttonSecondaryBorder;
    });

    // Add click handlers
    proceedBtn.addEventListener('click', () => {
      const dontAsk = dontAskCheckbox.checked;
      this.handleChoice('append', dontAsk);
    });

    cancelBtn.addEventListener('click', () => this.handleChoice('cancel', false));

    viewLink.addEventListener('click', (e) => {
      e.preventDefault();
      this.handleViewNote(existingNoteId);
    });

    // Close on overlay click
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) {
        this.handleChoice('cancel', false);
      }
    });

    // Close on Escape key
    const escapeHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        this.handleChoice('cancel', false);
        document.removeEventListener('keydown', escapeHandler);
      }
    };
    document.addEventListener('keydown', escapeHandler);

    // Append overlay and dialog separately to body (not nested!)
    // This prevents the dialog from inheriting overlay's opacity
    document.body.appendChild(this.overlay);
    document.body.appendChild(this.dialog);

    // Position dialog on top of overlay
    this.dialog.style.position = 'fixed';
    this.dialog.style.top = '50%';
    this.dialog.style.left = '50%';
    this.dialog.style.transform = 'translate(-50%, -50%)';

    // Focus the proceed button by default
    proceedBtn.focus();
  }

  private async handleChoice(action: 'append' | 'new' | 'cancel', dontAskAgain: boolean): Promise<void> {
    logger.info('User chose action', { action, dontAskAgain });

    // Save "don't ask again" preference if checked
    if (dontAskAgain && action === 'append') {
      try {
        await chrome.storage.sync.set({ 'auto_append_duplicates': true });
        logger.info('User preference saved: auto-append duplicates');
      } catch (error) {
        logger.error('Failed to save user preference', error as Error);
      }
    }

    if (this.resolvePromise) {
      this.resolvePromise({ action });
      this.resolvePromise = null;
    }

    this.close();
  }

  private async handleViewNote(noteId: string): Promise<void> {
    logger.info('Opening note in Trilium', { noteId });

    try {
      // Send message to background to open the note
      await chrome.runtime.sendMessage({
        type: 'OPEN_NOTE',
        noteId
      });
    } catch (error) {
      logger.error('Failed to open note', error as Error);
    }
  }

  private close(): void {
    // Remove overlay
    if (this.overlay && this.overlay.parentNode) {
      this.overlay.parentNode.removeChild(this.overlay);
    }

    // Remove dialog (now separate from overlay)
    if (this.dialog && this.dialog.parentNode) {
      this.dialog.parentNode.removeChild(this.dialog);
    }

    this.dialog = null;
    this.overlay = null;
  }
}
