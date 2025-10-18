import { CentralizedLogger, LogEntry } from '@/shared/utils';

class SimpleLogViewer {
  private logs: LogEntry[] = [];
  private autoRefreshTimer: number | null = null;
  private lastLogCount: number = 0;
  private autoRefreshEnabled: boolean = true;
  private expandedLogs: Set<string> = new Set(); // Track which logs are expanded

  constructor() {
    this.initialize();
  }

  private async initialize(): Promise<void> {
    this.setupEventHandlers();
    await this.loadLogs();
  }

  private setupEventHandlers(): void {
    const refreshBtn = document.getElementById('refresh-btn');
    const exportBtn = document.getElementById('export-btn');
    const clearBtn = document.getElementById('clear-btn');
    const expandAllBtn = document.getElementById('expand-all-btn');
    const collapseAllBtn = document.getElementById('collapse-all-btn');
    const levelFilter = document.getElementById('level-filter') as HTMLSelectElement;
    const sourceFilter = document.getElementById('source-filter') as HTMLSelectElement;
    const searchBox = document.getElementById('search-box') as HTMLInputElement;
    const autoRefreshSelect = document.getElementById('auto-refresh-interval') as HTMLSelectElement;

    refreshBtn?.addEventListener('click', () => this.loadLogs());
    exportBtn?.addEventListener('click', () => this.exportLogs());
    clearBtn?.addEventListener('click', () => this.clearLogs());
    expandAllBtn?.addEventListener('click', () => this.expandAllLogs());
    collapseAllBtn?.addEventListener('click', () => this.collapseAllLogs());
    levelFilter?.addEventListener('change', () => this.renderLogs());
    sourceFilter?.addEventListener('change', () => this.renderLogs());
    searchBox?.addEventListener('input', () => this.renderLogs());
    autoRefreshSelect?.addEventListener('change', (e) => this.handleAutoRefreshChange(e));

    // Start auto-refresh with default interval (5 seconds)
    this.startAutoRefresh(5000);

    // Pause auto-refresh when tab is not visible
    this.setupVisibilityHandling();
  }

  private setupVisibilityHandling(): void {
    document.addEventListener('visibilitychange', () => {
      this.autoRefreshEnabled = !document.hidden;

      // If tab becomes visible again, refresh immediately
      if (!document.hidden) {
        this.loadLogs();
      }
    });

    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
      this.stopAutoRefresh();
    });
  }

  private async loadLogs(): Promise<void> {
    try {
      const newLogs = await CentralizedLogger.getLogs();
      const hasNewLogs = newLogs.length !== this.lastLogCount;

      this.logs = newLogs;
      this.lastLogCount = newLogs.length;

      this.renderLogs();

      // Show notification if new logs arrived during auto-refresh
      if (hasNewLogs && this.logs.length > 0) {
        this.showNewLogsIndicator();
      }
    } catch (error) {
      console.error('Failed to load logs:', error);
      this.showError('Failed to load logs');
    }
  }

  private handleAutoRefreshChange(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const interval = parseInt(select.value);

    if (interval === 0) {
      this.stopAutoRefresh();
    } else {
      this.startAutoRefresh(interval);
    }
  }

  private startAutoRefresh(intervalMs: number): void {
    this.stopAutoRefresh(); // Clear any existing timer

    if (intervalMs > 0) {
      this.autoRefreshTimer = window.setInterval(() => {
        if (this.autoRefreshEnabled) {
          this.loadLogs();
        }
      }, intervalMs);
    }
  }

  private stopAutoRefresh(): void {
    if (this.autoRefreshTimer) {
      clearInterval(this.autoRefreshTimer);
      this.autoRefreshTimer = null;
    }
  }

  private showNewLogsIndicator(): void {
    // Flash the refresh button to indicate new logs
    const refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn) {
      refreshBtn.style.background = '#28a745';
      refreshBtn.textContent = 'New logs!';

      setTimeout(() => {
        refreshBtn.style.background = '#007cba';
        refreshBtn.textContent = 'Refresh';
      }, 2000);
    }
  }

  private renderLogs(): void {
    const logsList = document.getElementById('logs-list');
    if (!logsList) return;

    // Apply filters
    const levelFilter = (document.getElementById('level-filter') as HTMLSelectElement).value;
    const sourceFilter = (document.getElementById('source-filter') as HTMLSelectElement).value;
    const searchQuery = (document.getElementById('search-box') as HTMLInputElement).value.toLowerCase();

    let filteredLogs = this.logs.filter(log => {
      if (levelFilter && log.level !== levelFilter) return false;
      if (sourceFilter && log.source !== sourceFilter) return false;
      if (searchQuery) {
        const searchText = `${log.context} ${log.message}`.toLowerCase();
        if (!searchText.includes(searchQuery)) return false;
      }
      return true;
    });

    // Sort by timestamp (newest first)
    filteredLogs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    if (filteredLogs.length === 0) {
      logsList.innerHTML = '<div style="padding: 20px; text-align: center; color: #888;">No logs found</div>';
      return;
    }

    // Render simple log entries
    logsList.innerHTML = filteredLogs.map(log => this.renderLogItem(log)).join('');

    // Add event listeners for expand buttons
    this.setupExpandButtons();
  }

  private setupExpandButtons(): void {
    const expandButtons = document.querySelectorAll('.expand-btn');
    expandButtons.forEach(button => {
      button.addEventListener('click', (e) => {
        const btn = e.target as HTMLButtonElement;
        const logId = btn.getAttribute('data-log-id');
        if (!logId) return;

        const details = document.getElementById(`details-${logId}`);
        if (!details) return;

        if (this.expandedLogs.has(logId)) {
          // Collapse
          details.style.display = 'none';
          btn.textContent = 'Expand';
          this.expandedLogs.delete(logId);
        } else {
          // Expand
          details.style.display = 'block';
          btn.textContent = 'Collapse';
          this.expandedLogs.add(logId);
        }
      });
    });
  }

  private renderLogItem(log: LogEntry): string {
    const timestamp = new Date(log.timestamp).toLocaleString();
    const message = this.escapeHtml(`[${log.context}] ${log.message}`);

    // Handle additional data
    let details = '';
    if (log.args && log.args.length > 0) {
      details += `<div class="log-details">${JSON.stringify(log.args, null, 2)}</div>`;
    }
    if (log.error) {
      details += `<div class="log-details">Error: ${log.error.name}: ${log.error.message}</div>`;
    }

    const needsExpand = message.length > 200 || details;
    const displayMessage = needsExpand ? message.substring(0, 200) + '...' : message;

    // Check if this log is currently expanded
    const isExpanded = this.expandedLogs.has(log.id);
    const displayStyle = isExpanded ? 'block' : 'none';
    const buttonText = isExpanded ? 'Collapse' : 'Expand';

    return `
      <div class="log-item">
        <div class="log-meta">
          ${timestamp}
          <span class="log-level ${log.level}">${log.level}</span>
          <span style="color: #007cba;">${log.source}</span>
        </div>
        <div class="log-content">
          ${displayMessage}
          ${needsExpand ? `<button class="expand-btn" data-log-id="${log.id}">${buttonText}</button>` : ''}
          ${needsExpand ? `<div class="log-details" id="details-${log.id}" style="display: ${displayStyle};">${message}${details}</div>` : ''}
        </div>
      </div>
    `;
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  private async exportLogs(): Promise<void> {
    try {
      const logsJson = await CentralizedLogger.exportLogs();
      const blob = new Blob([logsJson], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = `trilium-logs-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to export logs:', error);
    }
  }

  private async clearLogs(): Promise<void> {
    if (confirm('Are you sure you want to clear all logs?')) {
      try {
        await CentralizedLogger.clearLogs();
        this.logs = [];
        this.expandedLogs.clear(); // Clear expanded state when clearing logs
        this.renderLogs();
      } catch (error) {
        console.error('Failed to clear logs:', error);
      }
    }
  }

  private expandAllLogs(): void {
    // Get all currently visible logs that can be expanded
    const expandButtons = document.querySelectorAll('.expand-btn');
    expandButtons.forEach(button => {
      const logId = button.getAttribute('data-log-id');
      if (logId) {
        this.expandedLogs.add(logId);
      }
    });

    // Re-render to apply the expanded state
    this.renderLogs();
  }

  private collapseAllLogs(): void {
    // Clear all expanded states
    this.expandedLogs.clear();

    // Re-render to apply the collapsed state
    this.renderLogs();
  }

  private showError(message: string): void {
    const logsList = document.getElementById('logs-list');
    if (logsList) {
      logsList.innerHTML = `<div style="padding: 20px; color: #dc3545; text-align: center;">${message}</div>`;
    }
  }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new SimpleLogViewer();
});
