/**
 * Code Block Allow List Settings Page
 *
 * Manages user interface for code block preservation allow list.
 * Handles loading, saving, adding, removing, and toggling allow list entries.
 *
 * @module codeblock-allowlist
 */

import { Logger } from '@/shared/utils';
import {
  loadCodeBlockSettings,
  saveCodeBlockSettings,
  addAllowListEntry,
  removeAllowListEntry,
  toggleAllowListEntry,
  resetToDefaults,
  isValidDomain,
  isValidURL,
  type CodeBlockSettings,
  type AllowListEntry
} from '@/shared/code-block-settings';

const logger = Logger.create('CodeBlockAllowList', 'options');

/**
 * Initialize the allow list settings page
 */
async function initialize(): Promise<void> {
  logger.info('Initializing Code Block Allow List settings page');

  try {
    // Load current settings
    const settings = await loadCodeBlockSettings();

    // Render UI with loaded settings
    renderSettings(settings);

    // Set up event listeners
    setupEventListeners();

    logger.info('Code Block Allow List page initialized successfully');
  } catch (error) {
    logger.error('Error initializing page', error as Error);
    showMessage('Failed to load settings. Please refresh the page.', 'error');
  }
}

/**
 * Render settings to the UI
 */
function renderSettings(settings: CodeBlockSettings): void {
  logger.debug('Rendering settings', settings);

  // Render master toggles
  const enableCheckbox = document.getElementById('enable-preservation') as HTMLInputElement;
  const autoDetectCheckbox = document.getElementById('auto-detect') as HTMLInputElement;

  if (enableCheckbox) {
    enableCheckbox.checked = settings.enabled;
  }

  if (autoDetectCheckbox) {
    autoDetectCheckbox.checked = settings.autoDetect;
  }

  // Render allow list table
  renderAllowList(settings.allowList);

  // Update UI state based on settings
  updateUIState(settings);
}

/**
 * Render the allow list table
 */
function renderAllowList(allowList: AllowListEntry[]): void {
  logger.debug('Rendering allow list', { count: allowList.length });

  const tbody = document.getElementById('allowlist-tbody');
  if (!tbody) {
    logger.error('Allow list table body not found');
    return;
  }

  // Clear existing rows
  tbody.innerHTML = '';

  // Show empty state if no entries
  if (allowList.length === 0) {
    tbody.innerHTML = `
      <tr class="empty-state">
        <td colspan="4" class="empty-message">
          <div class="empty-icon">📝</div>
          <div class="empty-text">No entries in allow list. Add your first entry above!</div>
        </td>
      </tr>
    `;
    return;
  }

  // Render each entry
  allowList.forEach((entry, index) => {
    const row = createAllowListRow(entry, index);
    tbody.appendChild(row);
  });
}

/**
 * Create a table row for an allow list entry
 */
function createAllowListRow(entry: AllowListEntry, index: number): HTMLTableRowElement {
  const row = document.createElement('tr');

  // Type column
  const typeCell = document.createElement('td');
  const typeBadge = document.createElement('span');
  typeBadge.className = entry.custom ? 'badge badge-custom' : 'badge badge-default';
  typeBadge.textContent = entry.custom ? 'Custom' : 'Default';
  typeCell.appendChild(typeBadge);
  row.appendChild(typeCell);

  // Value column
  const valueCell = document.createElement('td');
  valueCell.textContent = entry.value;
  valueCell.title = entry.value;
  row.appendChild(valueCell);

  // Status column (toggle)
  const statusCell = document.createElement('td');
  statusCell.className = 'col-status';
  const toggleLabel = document.createElement('label');
  toggleLabel.className = 'entry-toggle';
  const toggleInput = document.createElement('input');
  toggleInput.type = 'checkbox';
  toggleInput.checked = entry.enabled;
  toggleInput.dataset.index = String(index);
  const toggleSlider = document.createElement('span');
  toggleSlider.className = 'entry-toggle-slider';
  toggleLabel.appendChild(toggleInput);
  toggleLabel.appendChild(toggleSlider);
  statusCell.appendChild(toggleLabel);
  row.appendChild(statusCell);

  // Actions column (remove button)
  const actionsCell = document.createElement('td');
  actionsCell.className = 'col-actions';
  const removeBtn = document.createElement('button');
  removeBtn.className = 'btn-remove';
  removeBtn.textContent = '🗑️ Remove';
  removeBtn.dataset.index = String(index);
  removeBtn.disabled = !entry.custom; // Can't remove default entries
  actionsCell.appendChild(removeBtn);
  row.appendChild(actionsCell);

  return row;
}

/**
 * Set up event listeners
 */
function setupEventListeners(): void {
  logger.debug('Setting up event listeners');

  // Master toggles
  const enableCheckbox = document.getElementById('enable-preservation') as HTMLInputElement;
  const autoDetectCheckbox = document.getElementById('auto-detect') as HTMLInputElement;

  if (enableCheckbox) {
    enableCheckbox.addEventListener('change', handleMasterToggleChange);
  }

  if (autoDetectCheckbox) {
    autoDetectCheckbox.addEventListener('change', handleMasterToggleChange);
  }

  // Add entry button
  const addBtn = document.getElementById('add-entry-btn');
  if (addBtn) {
    addBtn.addEventListener('click', handleAddEntry);
  }

  // Entry value input (handle Enter key)
  const entryValue = document.getElementById('entry-value') as HTMLInputElement;
  if (entryValue) {
    entryValue.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        handleAddEntry();
      }
    });
  }

  // Allow list table (event delegation for toggle and remove)
  const tbody = document.getElementById('allowlist-tbody');
  if (tbody) {
    tbody.addEventListener('change', handleEntryToggle);
    tbody.addEventListener('click', handleEntryRemove);
  }

  // Reset defaults button
  const resetBtn = document.getElementById('reset-defaults-btn');
  if (resetBtn) {
    resetBtn.addEventListener('click', handleResetDefaults);
  }

  // Back button
  const backBtn = document.getElementById('back-btn');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      window.location.href = 'options.html';
    });
  }
}

/**
 * Handle master toggle change
 */
async function handleMasterToggleChange(): Promise<void> {
  logger.debug('Master toggle changed');

  try {
    const settings = await loadCodeBlockSettings();

    const enableCheckbox = document.getElementById('enable-preservation') as HTMLInputElement;
    const autoDetectCheckbox = document.getElementById('auto-detect') as HTMLInputElement;

    settings.enabled = enableCheckbox?.checked ?? settings.enabled;
    settings.autoDetect = autoDetectCheckbox?.checked ?? settings.autoDetect;

    await saveCodeBlockSettings(settings);
    updateUIState(settings);

    showMessage('Settings saved', 'success');
    logger.info('Master toggles updated', settings);
  } catch (error) {
    logger.error('Error saving master toggles', error as Error);
    showMessage('Failed to save settings', 'error');
  }
}

/**
 * Handle add entry
 */
async function handleAddEntry(): Promise<void> {
  logger.debug('Adding new entry');

  const typeSelect = document.getElementById('entry-type') as HTMLSelectElement;
  const valueInput = document.getElementById('entry-value') as HTMLInputElement;
  const addBtn = document.getElementById('add-entry-btn') as HTMLButtonElement;

  if (!typeSelect || !valueInput) {
    logger.error('Form elements not found');
    return;
  }

  const type = typeSelect.value as 'domain' | 'url';
  const value = valueInput.value.trim();

  // Validate input
  if (!value) {
    showMessage('Please enter a domain or URL', 'error');
    return;
  }

  // Validate format based on type
  if (type === 'domain' && !isValidDomain(value)) {
    showMessage(`Invalid domain format: ${value}. Use format like "example.com" or "*.example.com"`, 'error');
    return;
  }

  if (type === 'url' && !isValidURL(value)) {
    showMessage(`Invalid URL format: ${value}. Use format like "https://example.com/path"`, 'error');
    return;
  }

  // Disable button during operation
  if (addBtn) {
    addBtn.disabled = true;
  }

  try {
    // Add entry to settings
    const updatedSettings = await addAllowListEntry({
      type,
      value,
      enabled: true,
    });

    // Clear input
    valueInput.value = '';

    // Re-render UI
    renderSettings(updatedSettings);

    // Show success message
    showMessage(`Successfully added ${type}: ${value}`, 'success');
    logger.info('Entry added successfully', { type, value });
  } catch (error) {
    const errorMessage = (error as Error).message;
    logger.error('Error adding entry', error as Error);

    // Show user-friendly error message
    if (errorMessage.includes('already exists')) {
      showMessage(`Entry already exists: ${value}`, 'error');
    } else if (errorMessage.includes('Invalid')) {
      showMessage(errorMessage, 'error');
    } else {
      showMessage('Failed to add entry. Please try again.', 'error');
    }
  } finally {
    // Re-enable button
    if (addBtn) {
      addBtn.disabled = false;
    }
  }
}

/**
 * Handle entry toggle
 */
async function handleEntryToggle(event: Event): Promise<void> {
  const target = event.target as HTMLInputElement;
  if (target.type !== 'checkbox' || !target.dataset.index) {
    return;
  }

  const index = parseInt(target.dataset.index, 10);
  logger.debug('Entry toggle clicked', { index });

  // Store the checked state before async operation
  const newCheckedState = target.checked;

  try {
    // Toggle entry in settings
    const updatedSettings = await toggleAllowListEntry(index);

    // Re-render UI
    renderSettings(updatedSettings);

    // Show success message
    const entry = updatedSettings.allowList[index];
    const status = entry.enabled ? 'enabled' : 'disabled';
    showMessage(`Entry ${status}: ${entry.value}`, 'success');
    logger.info('Entry toggled successfully', { index, enabled: entry.enabled });
  } catch (error) {
    logger.error('Error toggling entry', error as Error, { index });
    showMessage('Failed to toggle entry. Please try again.', 'error');

    // Revert checkbox state on error
    target.checked = !newCheckedState;
  }
}

/**
 * Handle entry remove
 */
async function handleEntryRemove(event: Event): Promise<void> {
  const target = event.target as HTMLElement;
  if (!target.classList.contains('btn-remove')) {
    return;
  }

  const indexStr = target.dataset.index;
  if (indexStr === undefined) {
    return;
  }

  const index = parseInt(indexStr, 10);
  logger.debug('Remove button clicked', { index });

  // Get current settings to show entry value in confirmation
  const settings = await loadCodeBlockSettings();
  const entry = settings.allowList[index];

  if (!entry) {
    logger.error('Entry not found at index ' + index);
    showMessage('Entry not found. Please refresh the page.', 'error');
    return;
  }

  // Can't remove default entries (button should be disabled, but double-check)
  if (!entry.custom) {
    logger.warn('Attempted to remove default entry', { index, entry });
    showMessage('Cannot remove default entries', 'error');
    return;
  }

  // Confirm with user
  const confirmed = confirm(`Are you sure you want to remove this entry?\n\n${entry.type}: ${entry.value}`);
  if (!confirmed) {
    logger.debug('Remove cancelled by user');
    return;
  }

  // Disable button during operation
  const button = target as HTMLButtonElement;
  button.disabled = true;

  try {
    // Remove entry from settings
    const updatedSettings = await removeAllowListEntry(index);

    // Re-render UI
    renderSettings(updatedSettings);

    // Show success message
    showMessage(`Successfully removed: ${entry.value}`, 'success');
    logger.info('Entry removed successfully', { index, entry });
  } catch (error) {
    logger.error('Error removing entry', error as Error, { index });
    showMessage('Failed to remove entry. Please try again.', 'error');

    // Re-enable button on error
    button.disabled = false;
  }
}

/**
 * Handle reset to defaults
 */
async function handleResetDefaults(): Promise<void> {
  logger.debug('Reset to defaults clicked');

  // Confirm with user
  const confirmed = confirm(
    'Are you sure you want to reset to default settings?\n\n' +
    'This will:\n' +
    '- Remove all custom entries\n' +
    '- Restore default allow list\n' +
    '- Enable code block preservation\n' +
    '- Disable auto-detect mode\n\n' +
    'This action cannot be undone.'
  );

  if (!confirmed) {
    logger.debug('Reset cancelled by user');
    return;
  }

  const resetBtn = document.getElementById('reset-defaults-btn') as HTMLButtonElement;

  // Disable button during operation
  if (resetBtn) {
    resetBtn.disabled = true;
  }

  try {
    // Reset to defaults
    const defaultSettings = await resetToDefaults();

    // Re-render UI
    renderSettings(defaultSettings);

    // Show success message
    showMessage('Settings reset to defaults successfully', 'success');
    logger.info('Settings reset to defaults', {
      allowListCount: defaultSettings.allowList.length
    });
  } catch (error) {
    logger.error('Error resetting to defaults', error as Error);
    showMessage('Failed to reset settings. Please try again.', 'error');
  } finally {
    // Re-enable button
    if (resetBtn) {
      resetBtn.disabled = false;
    }
  }
}

/**
 * Update UI state based on settings
 */
function updateUIState(settings: CodeBlockSettings): void {
  logger.debug('Updating UI state', settings);

  const tableContainer = document.querySelector('.allowlist-table-container');
  const autoDetectCheckbox = document.getElementById('auto-detect') as HTMLInputElement;

  // Disable table if auto-detect is enabled or feature is disabled
  if (tableContainer) {
    if (!settings.enabled || settings.autoDetect) {
      tableContainer.classList.add('disabled');
    } else {
      tableContainer.classList.remove('disabled');
    }
  }

  // Disable auto-detect if feature is disabled
  if (autoDetectCheckbox) {
    autoDetectCheckbox.disabled = !settings.enabled;
  }
}

/**
 * Show a message to the user
 */
function showMessage(message: string, type: 'success' | 'error' | 'warning' = 'success'): void {
  logger.debug('Showing message', { message, type });

  const container = document.getElementById('message-container');
  const content = document.getElementById('message-content');

  if (!container || !content) {
    logger.warn('Message container not found');
    return;
  }

  content.textContent = message;
  content.className = `message-content ${type}`;
  container.style.display = 'block';

  // Auto-hide after 5 seconds
  setTimeout(() => {
    container.style.display = 'none';
  }, 5000);
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}
