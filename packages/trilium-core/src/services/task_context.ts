"use strict";

import type { ProgressPhase, TaskData, TaskResult, TaskType, WebSocketMessage } from "@triliumnext/commons";
import ws from "./ws.js";

// taskId => TaskContext
const taskContexts: Record<string, TaskContext<any>> = {};

class TaskContext<T extends TaskType> {
    private taskId: string;
    private taskType: TaskType;
    private progressCount: number;
    private totalCount: number | null;
    private phase: ProgressPhase | null;
    private lastSentCountTs: number;
    data: TaskData<T>;
    noteDeletionHandlerTriggered: boolean;

    constructor(taskId: string, taskType: T, data: TaskData<T>) {
        this.taskId = taskId;
        this.taskType = taskType;
        this.data = data;
        this.noteDeletionHandlerTriggered = false;
        this.totalCount = null;
        this.phase = null;

        // progressCount is meant to represent just some progress - to indicate the task is not stuck
        this.progressCount = -1; // we're incrementing immediately
        this.lastSentCountTs = 0; // 0 will guarantee the first message will be sent

        // just the fact this has been initialized is a progress which should be sent to clients
        // this is esp. important when importing big files/images which take a long time to upload/process
        // which means that first "real" increaseProgressCount() will be called quite late and user is without
        // feedback until then
        this.increaseProgressCount();
    }

    static getInstance<T extends TaskType>(taskId: string, taskType: T, data: TaskData<T>): TaskContext<T> {
        if (!taskContexts[taskId]) {
            taskContexts[taskId] = new TaskContext(taskId, taskType, data);
        }

        return taskContexts[taskId];
    }

    /**
     * Sets the total expected units of work, so progress messages can carry a denominator and the
     * client can show a progress bar instead of a bare count. Optional — tasks that don't know their
     * total up front simply never call this.
     */
    setTotalCount(totalCount: number) {
        this.totalCount = totalCount;
    }

    /**
     * Labels the phase the subsequent progress counts belong to, so the client can render a phase-specific
     * message (e.g. "Extracted X items" vs "Processed X notes"). Typically paired with resetProgressCount()
     * and setTotalCount() at a phase boundary so each phase drives its own 0→100% bar. Forces the next
     * progress message to send immediately (bypassing the throttle) so the label switches without delay.
     */
    setPhase(phase: ProgressPhase) {
        this.phase = phase;
        this.lastSentCountTs = 0;
    }

    /**
     * Resets the running progress count back to zero. Useful for multi-phase tasks (e.g. zip export,
     * which first walks the tree to build metadata and then walks it again to write content) so a later
     * phase can drive a 0→100% progress bar from scratch instead of continuing the earlier phase's count.
     */
    resetProgressCount() {
        this.progressCount = 0;
    }

    increaseProgressCount() {
        this.progressCount++;

        if (Date.now() - this.lastSentCountTs >= 300 && this.taskId !== "no-progress-reporting") {
            this.lastSentCountTs = Date.now();

            ws.sendMessageToAllClients({
                type: "taskProgressCount",
                taskId: this.taskId,
                taskType: this.taskType,
                data: this.data,
                progressCount: this.progressCount,
                ...(this.totalCount !== null ? { totalCount: this.totalCount } : {}),
                ...(this.phase !== null ? { phase: this.phase } : {})
            } as WebSocketMessage);
        }
    }

    reportError(message: string) {
        ws.sendMessageToAllClients({
            type: "taskError",
            taskId: this.taskId,
            taskType: this.taskType,
            data: this.data,
            message
        } as WebSocketMessage);
    }

    taskSucceeded(result: TaskResult<T>) {
        ws.sendMessageToAllClients({
            type: "taskSucceeded",
            taskId: this.taskId,
            taskType: this.taskType,
            data: this.data,
            result
        } as WebSocketMessage);
    }
}

export default TaskContext;
