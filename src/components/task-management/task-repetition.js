/**
 * Trilium Task Management - Task Repetition Component
 * Handles recurring tasks with various repeat patterns
 */

class TaskRepetition {
    constructor() {
        this.patterns = {
            daily: { name: 'Daily', interval: 1, unit: 'day' },
            weekly: { name: 'Weekly', interval: 1, unit: 'week' },
            biweekly: { name: 'Bi-weekly', interval: 2, unit: 'week' },
            monthly: { name: 'Monthly', interval: 1, unit: 'month' },
            quarterly: { name: 'Quarterly', interval: 3, unit: 'month' },
            yearly: { name: 'Yearly', interval: 1, unit: 'year' },
            weekdays: { name: 'Weekdays', type: 'custom', days: [1, 2, 3, 4, 5] },
            weekends: { name: 'Weekends', type: 'custom', days: [0, 6] }
        };
    }

    /**
     * Parse repeat pattern from note content
     * Supports simple patterns: [repeat::daily], [repeat::weekly], etc.
     * Note: Custom patterns like [repeat::custom:Mon,Wed,Fri] are not yet implemented
     */
    parseRepeatPattern(content) {
        const repeatRegex = /\[repeat::(\w+)\]/i;
        const match = content.match(repeatRegex);
        
        if (match) {
            const pattern = match[1].toLowerCase();
            return {
                pattern,
                isValid: this.patterns.hasOwnProperty(pattern)
            };
        }
        
        return null;
    }

    /**
     * Calculate next occurrence based on repeat pattern
     */
    getNextOccurrence(lastDate, pattern, customConfig = null) {
        const date = new Date(lastDate);
        const patternConfig = this.patterns[pattern];
        
        if (!patternConfig) return null;

        if (patternConfig.type === 'custom' && patternConfig.days) {
            // Handle custom day patterns (weekdays, weekends)
            return this.getNextCustomDay(date, patternConfig.days);
        }

        switch (patternConfig.unit) {
            case 'day':
                date.setDate(date.getDate() + patternConfig.interval);
                break;
            case 'week':
                date.setDate(date.getDate() + (patternConfig.interval * 7));
                break;
            case 'month':
                date.setMonth(date.getMonth() + patternConfig.interval);
                break;
            case 'year':
                date.setFullYear(date.getFullYear() + patternConfig.interval);
                break;
        }

        return date;
    }

    getNextCustomDay(fromDate, allowedDays) {
        const date = new Date(fromDate);
        let attempts = 0;
        
        do {
            date.setDate(date.getDate() + 1);
            attempts++;
        } while (!allowedDays.includes(date.getDay()) && attempts < 14);
        
        return date;
    }

    /**
     * Generate repeat options HTML for UI
     */
    renderRepeatOptions(selectedPattern = null) {
        const options = Object.entries(this.patterns).map(([key, config]) => {
            const isSelected = key === selectedPattern ? 'selected' : '';
            return `<option value="${key}" ${isSelected}>${config.name}</option>`;
        }).join('');

        return `
            <div class="task-repeat-selector">
                <label>Repeat Pattern:</label>
                <select class="repeat-pattern-select">
                    <option value="">No Repeat</option>
                    ${options}
                </select>
                <div class="repeat-info">
                    <small>Supported: daily, weekly, monthly, yearly, weekdays, weekends</small>
                </div>
            </div>
        `;
    }

    /**
     * Create a repeated task instance
     */
    createRepeatedTask(originalNote, newDueDate) {
        return {
            ...originalNote,
            dueDate: newDueDate,
            isRecurring: true,
            originalNoteId: originalNote.id,
            createdFromRepeat: new Date().toISOString()
        };
    }

    /**
     * Render repeat indicator for task list
     */
    renderRepeatIndicator(pattern) {
        const patternConfig = this.patterns[pattern];
        if (!patternConfig) return '';

        const icons = {
            daily: '🔁',
            weekly: '📅',
            biweekly: '📅',
            monthly: '📆',
            quarterly: '📆',
            yearly: '📅',
            weekdays: '🏢',
            weekends: '🏖️'
        };

        return `
            <span class="repeat-indicator" title="Repeats ${patternConfig.name}">
                ${icons[pattern] || '🔄'} ${patternConfig.name}
            </span>
        `;
    }

    /**
     * CSS styles for repetition component
     */
    static getStyles() {
        return `
            .task-repeat-selector {
                padding: 12px;
                background: var(--card-background-color);
                border-radius: 8px;
                margin: 8px 0;
            }
            
            .task-repeat-selector label {
                display: block;
                font-size: 13px;
                font-weight: 600;
                margin-bottom: 6px;
                color: var(--text-color);
            }
            
            .repeat-pattern-select {
                width: 100%;
                padding: 8px 12px;
                border: 1px solid var(--border-color);
                border-radius: 6px;
                background: var(--input-background);
                color: var(--text-color);
                font-size: 14px;
            }
            
            .repeat-info {
                margin-top: 8px;
                font-size: 12px;
                color: var(--muted-text-color);
            }
            
            .repeat-indicator {
                display: inline-flex;
                align-items: center;
                gap: 4px;
                padding: 2px 8px;
                background: var(--accent-color);
                color: white;
                border-radius: 12px;
                font-size: 11px;
                font-weight: 500;
            }
        `;
    }
}

module.exports = TaskRepetition;
