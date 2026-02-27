/**
 * Trilium Task Management - Task Timeline Component
 * Displays task due dates on a visual timeline
 */

class TaskTimeline {
    constructor() {
        // Constructor is empty - no unused properties
    }

    /**
     * Parse tasks with due dates from notes
     * Expected format: [due::2026-03-01] or @due(2026-03-01)
     */
    parseTaskDueDates(noteContent, noteId, noteTitle) {
        // Support multiple due date formats
        const dueDateRegex = /\[due::(\d{4}-\d{2}-\d{2})\]|@due\((\d{4}-\d{2}-\d{2})\)/gi;
        const tasks = [];
        let match;

        // Get today's date at midnight for proper comparison
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        while ((match = dueDateRegex.exec(noteContent)) !== null) {
            const dueDate = match[1] || match[2];
            const dueDateObj = new Date(dueDate);
            
            tasks.push({
                noteId,
                noteTitle,
                dueDate,
                isOverdue: dueDateObj < today,
                isToday: dueDateObj.getTime() === today.getTime()
            });
        }

        return tasks;
    }

    /**
     * Group tasks by time period
     */
    groupTasksByPeriod(tasks) {
        const groups = {
            overdue: [],
            today: [],
            thisWeek: [],
            thisMonth: [],
            future: []
        };

        // Get today's date at midnight
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        tasks.forEach(task => {
            const dueDate = new Date(task.dueDate);
            const diffDays = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));

            if (task.isOverdue) {
                groups.overdue.push(task);
            } else if (task.isToday) {
                groups.today.push(task);
            } else if (diffDays <= 7) {
                groups.thisWeek.push(task);
            } else if (diffDays <= 30) {
                groups.thisMonth.push(task);
            } else {
                groups.future.push(task);
            }
        });

        return groups;
    }

    /**
     * Render timeline HTML
     */
    renderTimeline(tasks) {
        const grouped = this.groupTasksByPeriod(tasks);
        
        return `
            <div class="task-timeline-container">
                ${this.renderTimelineSection('Overdue', grouped.overdue, 'overdue')}
                ${this.renderTimelineSection('Today', grouped.today, 'today')}
                ${this.renderTimelineSection('This Week', grouped.thisWeek, 'this-week')}
                ${this.renderTimelineSection('This Month', grouped.thisMonth, 'this-month')}
                ${this.renderTimelineSection('Future', grouped.future, 'future')}
            </div>
        `;
    }

    renderTimelineSection(title, tasks, cssClass) {
        if (tasks.length === 0) return '';

        const taskItems = tasks.map(task => `
            <div class="timeline-task-item ${cssClass}" data-note-id="${task.noteId}">
                <span class="task-due-date">${this.formatDate(task.dueDate)}</span>
                <span class="task-title">${task.noteTitle}</span>
            </div>
        `).join('');

        return `
            <div class="timeline-section ${cssClass}">
                <div class="timeline-header">
                    <span class="timeline-title">${title}</span>
                    <span class="timeline-count">${tasks.length}</span>
                </div>
                <div class="timeline-tasks">
                    ${taskItems}
                </div>
            </div>
        `;
    }

    /**
     * Format date using user's locale
     */
    formatDate(dateStr) {
        const date = new Date(dateStr);
        // Use user's locale instead of hardcoded 'en-US'
        return date.toLocaleDateString(undefined, { 
            month: 'short', 
            day: 'numeric' 
        });
    }

    /**
     * CSS styles for timeline
     */
    static getStyles() {
        return `
            .task-timeline-container {
                padding: 16px;
                background: var(--card-background-color);
                border-radius: 8px;
            }
            
            .timeline-section {
                margin-bottom: 16px;
            }
            
            .timeline-section:last-child {
                margin-bottom: 0;
            }
            
            .timeline-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 8px 0;
                border-bottom: 2px solid var(--border-color);
                margin-bottom: 8px;
            }
            
            .timeline-title {
                font-weight: 600;
                font-size: 14px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            
            .timeline-count {
                background: var(--muted-text-color);
                color: white;
                padding: 2px 8px;
                border-radius: 12px;
                font-size: 12px;
            }
            
            .timeline-tasks {
                display: flex;
                flex-direction: column;
                gap: 4px;
            }
            
            .timeline-task-item {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 8px 12px;
                border-radius: 6px;
                cursor: pointer;
                transition: background 0.2s;
            }
            
            .timeline-task-item:hover {
                background: var(--hover-background);
            }
            
            .timeline-task-item.overdue .task-due-date {
                color: #e74c3c;
                font-weight: 600;
            }
            
            .timeline-task-item.today .task-due-date {
                color: #3498db;
                font-weight: 600;
            }
            
            .timeline-task-item.this-week .task-due-date {
                color: #f39c12;
            }
            
            .task-due-date {
                font-size: 13px;
                min-width: 60px;
                color: var(--muted-text-color);
            }
            
            .task-title {
                font-size: 14px;
                color: var(--text-color);
            }
        `;
    }
}

module.exports = TaskTimeline;
