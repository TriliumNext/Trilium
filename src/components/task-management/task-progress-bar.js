/**
 * Trilium Task Management - Task Progress Bar Component
 * Implements percentage-based progress bar for task notes
 */

class TaskProgressBar {
    constructor(noteId) {
        this.noteId = noteId;
    }

    /**
     * Calculate progress from note content
     * Scans for checkboxes and calculates completion percentage
     */
    calculateProgress(content) {
        // Match both checked and unchecked checkboxes
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
     * Render progress bar HTML
     */
    renderProgressBar(progress) {
        const { percentage, checked, total } = progress;
        
        return `
            <div class="task-progress-bar-container">
                <div class="task-progress-info">
                    <span class="task-progress-percentage">${percentage}%</span>
                    <span class="task-progress-count">(${checked}/${total})</span>
                </div>
                <div class="task-progress-bar">
                    <div class="task-progress-fill" style="width: ${percentage}%;"></div>
                </div>
            </div>
        `;
    }

    /**
     * Apply styling for the progress bar
     */
    static getStyles() {
        return `
            .task-progress-bar-container {
                padding: 8px 12px;
                background: var(--card-background-color);
                border-radius: 6px;
                margin: 8px 0;
            }
            
            .task-progress-info {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 6px;
            }
            
            .task-progress-percentage {
                font-weight: 600;
                font-size: 14px;
                color: var(--text-color);
            }
            
            .task-progress-count {
                font-size: 12px;
                color: var(--muted-text-color);
            }
            
            .task-progress-bar {
                height: 8px;
                background: var(--progress-bar-background);
                border-radius: 4px;
                overflow: hidden;
            }
            
            .task-progress-fill {
                height: 100%;
                background: linear-gradient(90deg, var(--primary-color), var(--accent-color));
                border-radius: 4px;
                transition: width 0.3s ease;
            }
        `;
    }
}

module.exports = TaskProgressBar;
