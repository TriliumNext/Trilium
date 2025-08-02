interface ProgressStage {
    id: string;
    label: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    progress: number; // 0-100
    startTime?: number;
    endTime?: number;
    message?: string;
    estimatedDuration?: number;
}

interface ProgressUpdate {
    stageId: string;
    progress: number;
    status: 'pending' | 'running' | 'completed' | 'failed';
    message?: string;
    estimatedTimeRemaining?: number;
}

/**
 * Enhanced Progress Indicator for LLM Chat Operations
 * Displays multi-stage progress with progress bars, timing, and status updates
 */
export class ProgressIndicator {
    private container: HTMLElement;
    private stages: Map<string, ProgressStage> = new Map();
    private overallProgress: number = 0;
    private isVisible: boolean = false;

    constructor(parentElement: HTMLElement) {
        this.container = this.createProgressContainer();
        parentElement.appendChild(this.container);
        this.hide();
    }

    /**
     * Create the main progress container
     */
    private createProgressContainer(): HTMLElement {
        const container = document.createElement('div');
        container.className = 'llm-progress-container';
        container.innerHTML = `
            <div class="llm-progress-header">
                <div class="llm-progress-title">Processing...</div>
                <div class="llm-progress-overall">
                    <div class="llm-progress-bar-container">
                        <div class="llm-progress-bar-fill" style="width: 0%"></div>
                    </div>
                    <div class="llm-progress-percentage">0%</div>
                </div>
            </div>
            <div class="llm-progress-stages"></div>
            <div class="llm-progress-footer">
                <div class="llm-progress-time-info">
                    <span class="elapsed-time">Elapsed: 0s</span>
                    <span class="estimated-remaining">Est. remaining: --</span>
                </div>
                <button class="llm-progress-cancel-btn" title="Cancel operation">
                    <i class="fas fa-times"></i> Cancel
                </button>
            </div>
        `;
        return container;
    }

    /**
     * Show the progress indicator
     */
    public show(): void {
        if (!this.isVisible) {
            this.container.style.display = 'block';
            this.container.classList.add('fade-in');
            this.isVisible = true;
            this.startElapsedTimer();
        }
    }

    /**
     * Hide the progress indicator
     */
    public hide(): void {
        if (this.isVisible) {
            this.container.classList.add('fade-out');
            setTimeout(() => {
                this.container.style.display = 'none';
                this.container.classList.remove('fade-in', 'fade-out');
                this.isVisible = false;
                this.stopElapsedTimer();
            }, 300);
        }
    }

    /**
     * Add a new progress stage
     */
    public addStage(stageId: string, label: string, estimatedDuration?: number): void {
        const stage: ProgressStage = {
            id: stageId,
            label,
            status: 'pending',
            progress: 0,
            estimatedDuration
        };

        this.stages.set(stageId, stage);
        this.renderStage(stage);
        this.updateOverallProgress();
    }

    /**
     * Update progress for a specific stage
     */
    public updateStageProgress(update: ProgressUpdate): void {
        const stage = this.stages.get(update.stageId);
        if (!stage) return;

        // Update stage data
        stage.progress = Math.max(0, Math.min(100, update.progress));
        stage.status = update.status;
        stage.message = update.message;

        // Set timing
        if (update.status === 'running' && !stage.startTime) {
            stage.startTime = Date.now();
        } else if ((update.status === 'completed' || update.status === 'failed') && stage.startTime && !stage.endTime) {
            stage.endTime = Date.now();
        }

        this.renderStage(stage);
        this.updateOverallProgress();

        if (update.estimatedTimeRemaining !== undefined) {
            this.updateEstimatedTime(update.estimatedTimeRemaining);
        }
    }

    /**
     * Mark a stage as completed
     */
    public completeStage(stageId: string): void {
        this.updateStageProgress({
            stageId,
            progress: 100,
            status: 'completed',
            message: 'Completed'
        });
    }

    /**
     * Mark a stage as failed
     */
    public failStage(stageId: string, message?: string): void {
        this.updateStageProgress({
            stageId,
            progress: 0,
            status: 'failed',
            message: message || 'Failed'
        });
    }

    /**
     * Render a specific stage
     */
    private renderStage(stage: ProgressStage): void {
        const stagesContainer = this.container.querySelector('.llm-progress-stages') as HTMLElement;
        let stageElement = stagesContainer.querySelector(`[data-stage-id="${stage.id}"]`) as HTMLElement;

        if (!stageElement) {
            stageElement = this.createStageElement(stage);
            stagesContainer.appendChild(stageElement);
        }

        this.updateStageElement(stageElement, stage);
    }

    /**
     * Create a new stage element
     */
    private createStageElement(stage: ProgressStage): HTMLElement {
        const element = document.createElement('div');
        element.className = 'llm-progress-stage';
        element.setAttribute('data-stage-id', stage.id);
        
        element.innerHTML = `
            <div class="stage-header">
                <div class="stage-status-icon">
                    <i class="fas fa-circle"></i>
                </div>
                <div class="stage-label">${stage.label}</div>
                <div class="stage-timing"></div>
            </div>
            <div class="stage-progress">
                <div class="stage-progress-bar">
                    <div class="stage-progress-fill"></div>
                </div>
                <div class="stage-progress-text">0%</div>
            </div>
            <div class="stage-message"></div>
        `;

        return element;
    }

    /**
     * Update stage element with current data
     */
    private updateStageElement(element: HTMLElement, stage: ProgressStage): void {
        // Update status icon
        const icon = element.querySelector('.stage-status-icon i') as HTMLElement;
        icon.className = this.getStatusIcon(stage.status);

        // Update progress bar
        const progressFill = element.querySelector('.stage-progress-fill') as HTMLElement;
        progressFill.style.width = `${stage.progress}%`;

        // Update progress text
        const progressText = element.querySelector('.stage-progress-text') as HTMLElement;
        progressText.textContent = `${Math.round(stage.progress)}%`;

        // Update message
        const messageElement = element.querySelector('.stage-message') as HTMLElement;
        messageElement.textContent = stage.message || '';
        messageElement.style.display = stage.message ? 'block' : 'none';

        // Update timing
        const timingElement = element.querySelector('.stage-timing') as HTMLElement;
        timingElement.textContent = this.getStageTimingText(stage);

        // Update stage status class
        element.className = `llm-progress-stage stage-${stage.status}`;
    }

    /**
     * Get status icon for stage
     */
    private getStatusIcon(status: string): string {
        switch (status) {
            case 'pending': return 'fas fa-circle text-muted';
            case 'running': return 'fas fa-spinner fa-spin text-primary';
            case 'completed': return 'fas fa-check-circle text-success';
            case 'failed': return 'fas fa-exclamation-circle text-danger';
            default: return 'fas fa-circle';
        }
    }

    /**
     * Get timing text for stage
     */
    private getStageTimingText(stage: ProgressStage): string {
        if (stage.endTime && stage.startTime) {
            const duration = Math.round((stage.endTime - stage.startTime) / 1000);
            return `${duration}s`;
        } else if (stage.startTime) {
            const elapsed = Math.round((Date.now() - stage.startTime) / 1000);
            return `${elapsed}s`;
        } else if (stage.estimatedDuration) {
            return `~${stage.estimatedDuration / 1000}s`;
        }
        return '';
    }

    /**
     * Update overall progress
     */
    private updateOverallProgress(): void {
        if (this.stages.size === 0) {
            this.overallProgress = 0;
        } else {
            const totalProgress = Array.from(this.stages.values())
                .reduce((sum, stage) => sum + stage.progress, 0);
            this.overallProgress = totalProgress / this.stages.size;
        }

        // Update overall progress bar
        const overallFill = this.container.querySelector('.llm-progress-bar-fill') as HTMLElement;
        overallFill.style.width = `${this.overallProgress}%`;

        // Update percentage text
        const percentageText = this.container.querySelector('.llm-progress-percentage') as HTMLElement;
        percentageText.textContent = `${Math.round(this.overallProgress)}%`;

        // Update title based on progress
        const titleElement = this.container.querySelector('.llm-progress-title') as HTMLElement;
        if (this.overallProgress >= 100) {
            titleElement.textContent = 'Completed';
        } else if (this.overallProgress > 0) {
            titleElement.textContent = 'Processing...';
        } else {
            titleElement.textContent = 'Starting...';
        }
    }

    /**
     * Update estimated remaining time
     */
    private updateEstimatedTime(seconds: number): void {
        const estimatedElement = this.container.querySelector('.estimated-remaining') as HTMLElement;
        if (seconds > 0) {
            estimatedElement.textContent = `Est. remaining: ${this.formatTime(seconds)}`;
        } else {
            estimatedElement.textContent = 'Est. remaining: --';
        }
    }

    /**
     * Format time in seconds to readable format
     */
    private formatTime(seconds: number): string {
        if (seconds < 60) {
            return `${Math.round(seconds)}s`;
        } else if (seconds < 3600) {
            const minutes = Math.floor(seconds / 60);
            const remainingSeconds = Math.round(seconds % 60);
            return `${minutes}m ${remainingSeconds}s`;
        } else {
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            return `${hours}h ${minutes}m`;
        }
    }

    /**
     * Start elapsed time timer
     */
    private elapsedTimer?: number;
    private startTime: number = Date.now();

    private startElapsedTimer(): void {
        this.startTime = Date.now();
        this.elapsedTimer = window.setInterval(() => {
            const elapsed = Math.round((Date.now() - this.startTime) / 1000);
            const elapsedElement = this.container.querySelector('.elapsed-time') as HTMLElement;
            elapsedElement.textContent = `Elapsed: ${this.formatTime(elapsed)}`;
        }, 1000);
    }

    /**
     * Stop elapsed time timer
     */
    private stopElapsedTimer(): void {
        if (this.elapsedTimer) {
            clearInterval(this.elapsedTimer);
            this.elapsedTimer = undefined;
        }
    }

    /**
     * Clear all stages and reset
     */
    public reset(): void {
        this.stages.clear();
        const stagesContainer = this.container.querySelector('.llm-progress-stages') as HTMLElement;
        stagesContainer.innerHTML = '';
        this.overallProgress = 0;
        this.updateOverallProgress();
        this.stopElapsedTimer();
    }

    /**
     * Set cancel callback
     */
    public onCancel(callback: () => void): void {
        const cancelBtn = this.container.querySelector('.llm-progress-cancel-btn') as HTMLElement;
        cancelBtn.onclick = callback;
    }

    /**
     * Disable cancel button
     */
    public disableCancel(): void {
        const cancelBtn = this.container.querySelector('.llm-progress-cancel-btn') as HTMLButtonElement;
        cancelBtn.disabled = true;
        cancelBtn.style.opacity = '0.5';
    }

    /**
     * Enable cancel button
     */
    public enableCancel(): void {
        const cancelBtn = this.container.querySelector('.llm-progress-cancel-btn') as HTMLButtonElement;
        cancelBtn.disabled = false;
        cancelBtn.style.opacity = '1';
    }
}

// Export types for use in other modules
export type { ProgressStage, ProgressUpdate };