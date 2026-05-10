export interface TaskProgress {
    completed: number;
    total: number;
    percentage: number;
}

const TASK_ITEM_SELECTOR = "li.todo-list__item .todo-list__label input[type='checkbox']";
const parser = new DOMParser();

/**
 * Calculates progress from CKEditor TodoList HTML stored in text note content.
 */
export function calculateTaskProgress(content: string | null | undefined): TaskProgress | null {
    if (!content || !content.includes("todo-list__item")) {
        return null;
    }

    const document = parser.parseFromString(content, "text/html");
    const checkboxes = document.querySelectorAll(TASK_ITEM_SELECTOR);
    const total = checkboxes.length;

    if (!total) {
        return null;
    }

    let completed = 0;
    for (const checkbox of checkboxes) {
        if (checkbox.hasAttribute("checked")) {
            completed++;
        }
    }

    return {
        completed,
        total,
        percentage: Math.round((completed / total) * 100)
    };
}
