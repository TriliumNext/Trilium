/**
 * Trilium Kanban Board Widget - Task Management Extension
 * 
 * This widget integrates Task Progress Bar, Timeline, and Repetition
 * into Trilium's existing Kanban board view.
 * 
 * Usage: Add this script to Trilium's widget folder
 */

// Import components (when using ES modules)
// import { TaskProgressBar } from '../components/task-progress-bar.js';
// import { TaskTimeline } from '../components/task-timeline.js';
// import { TaskRepetition } from '../components/task-repetition.js';

class KanbanTaskWidget {
    constructor() {
        this.noteId = null;
        this.container = null;
    }

    /**
     * Initialize widget for a specific note
     */
    async init(noteId) {
        this.noteId = noteId;
        await this.render();
        this.attachEventListeners();
    }

    /**
     * Render the widget UI
     */
    async render() {
        const note = await api.getNote(this.noteId);
        if (!note) return;

        const content = note.content || '';
        
        // Calculate progress
        const progress = this.calculateProgress(content);
        
        // Parse due dates
        const dueDate = this.parseDueDate(content);
        
        // Parse repeat pattern
        const repeatPattern = this.parseRepeatPattern(content);

        const widgetHtml = `
            <div class="kanban-task-widget">
                ${this.renderProgressBar(progress)}
                ${dueDate ? this.renderDueDate(dueDate) : ''}
                ${repeatPattern ? this.renderRepeatIndicator(repeatPattern) : ''}
            </div>
        `;

        return widgetHtml;
    }

    /**
     * Calculate task progress from checkboxes
     */
    calculateProgress(content) {
        const checkedRegex = /- \[x\]/gi;
        const uncheckedRegex = /- \[ \]/gi;
        
        const checkedCount = (content.match(checkedRegex) || []).length;
        const uncheckedCount = (content.match(uncheckedRegex) || []).length;
        const totalCount = checkedCount + uncheckedCount;
        
        if (totalCount === 0) {
            return { percentage: 0, checked: 0, total: 0 };
        }
        
        const percentage = Math.round((checkedCount / totalCount) * 100);
        return { percentage, checked: checkedCount, total: totalCount };
    }

    /**
     * Parse due date from note content
     * Supports: [due::YYYY-MM-DD] or @due(YYYY-MM-DD)
     */
    parseDueDate(content) {
        const dueDateRegex = /\[due::(\d{4}-\d{2}-\d{2})\]|@due\((\d{4}-\d{2}-\d{2})\)/i;
        const match = content.match(dueDateRegex);
        
        if (match) {
            const dateStr = match[1] || match[2];
            const dueDate = new Date(dateStr);
            const now = new Date();
            
            return {
                date: dateStr,
                isOverdue: dueDate < now,
                isToday: dueDate.toDateString() === now.toDateString()
            };
        }
        
        return null;
    }

    /**
     * Parse repeat pattern from note content
     * Supports: [repeat::daily|weekly|monthly|...]
     */
    parseRepeatPattern(content) {
        const repeatRegex = /\[repeat::(\w+)\]/i;
        const match = content.match(repeatRegex);
        return match ? match[1] : null;
    }

    /**
     * Render progress bar HTML
     */
    renderProgressBar(progress) {
        if (progress.total === 0) return '';

        return `
            <div class="task-progress-mini">
                <div class="progress-bar-mini">
                    <div class="progress-fill-mini" style="width: ${progress.percentage}%"></div>
                </div>
                <span class="progress-text-mini">${progress.percentage}%</span>
            </div>
        `;
    }

    /**
     * Render due date indicator
     */
    renderDueDate(dueDate) {
        let cssClass = '';
        let icon = '📅';
        
        if (dueDate.isOverdue) {
            cssClass = 'overdue';
            icon = '🔴';
        } else if (dueDate.isToday) {
            cssClass = 'today';
            icon = '🔵';
        }

        return `
            <span class="due-date-indicator ${cssClass}">
                ${icon} ${dueDate.date}
            </span>
        `;
    }

    /**
     * Render repeat indicator
     */
    renderRepeatIndicator(pattern) {
        const patternNames = {
            daily: 'Daily',
            weekly: 'Weekly',
            monthly: 'Monthly',
            yearly: 'Yearly'
        };

        const name = patternNames[pattern] || pattern;
        
        return `
            <span class="repeat-indicator">
                🔄 ${name}
            </span>
        `;
    }

    /**
     * Attach event listeners
     */
    attachEventListeners() {
        // Listen for checkbox changes
        document.addEventListener('click', (e) => {
            if (e.target.matches('input[type="checkbox"]')) {
                // Debounce the update
                clearTimeout(this.updateTimeout);
                this.updateTimeout = setTimeout(() => {
                    this.refresh();
                }, 300);
            }
        });
    }

    /**
     * Refresh widget display
     */
    async refresh() {
        const html = await this.render();
        if (this.container) {
            this.container.innerHTML = html;
        }
    }
}

// CSS Styles for the widget
const widgetStyles = `
    .kanban-task-widget {
        padding: 8px;
        background: var(--card-background-color);
        border-radius: 4px;
        margin-top: 8px;
    }

    .task-progress-mini {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 4px;
    }

    .progress-bar-mini {
        flex: 1;
        height: 4px;
        background: var(--progress-bar-background);
        border-radius: 2px;
        overflow: hidden;
    }

    .progress-fill-mini {
        height: 100%;
        background: var(--primary-color);
        border-radius: 2px;
        transition: width 0.3s ease;
    }

    .progress-text-mini {
        font-size: 11px;
        font-weight: 600;
        color: var(--text-color);
        min-width: 32px;
    }

    .due-date-indicator {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 11px;
        color: var(--muted-text-color);
        margin-right: 8px;
    }

    .due-date-indicator.overdue {
        color: #e74c3c;
        font-weight: 600;
    }

    .due-date-indicator.today {
        color: #3498db;
        font-weight: 600;
    }

    .repeat-indicator {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 11px;
        color: var(--accent-color);
        background: var(--accent-background);
        padding: 2px 6px;
        border-radius: 10px;
    }
`;

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { KanbanTaskWidget, widgetStyles };
}

// Auto-initialize if in browser
if (typeof window !== 'undefined') {
    window.KanbanTaskWidget = KanbanTaskWidget;
}
