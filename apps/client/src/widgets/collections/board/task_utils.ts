export interface TaskProgress {
    completed: number;
    total: number;
    percentage: number;
}

const CHECKED_TASK_ITEM_SELECTOR = "li.todo-list__item .todo-list__label input[type='checkbox'][checked]";
const TASK_ITEM_SELECTOR = "li.todo-list__item .todo-list__label input[type='checkbox']";

/**
 * Calculates progress from CKEditor TodoList HTML stored in text note content.
 */
export function calculateTaskProgress(content: string | null | undefined): TaskProgress | null {
    if (!content?.trim() || !content.includes("todo-list__item")) {
        return null;
    }

    const document = new DOMParser().parseFromString(content, "text/html");
    const total = document.querySelectorAll(TASK_ITEM_SELECTOR).length;

    if (!total) {
        return null;
    }

    const completed = document.querySelectorAll(CHECKED_TASK_ITEM_SELECTOR).length;

    return {
        completed,
        total,
        percentage: Math.round((completed / total) * 100)
    };
}
