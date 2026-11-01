import { Plugin } from "ckeditor5";
import TodoListMultistateAutoformat from "./todo_list_multistate_autoformat.js";
import TodoListMultistateEditing from "./todo_list_multistate_editing.js";
import TodoListMultistateToolbar from "./todo_list_multistate_toolbar.js";
import TodoListMultistateUI from "./todo_list_multistate_ui.js";

export default class TodoListMultistate extends Plugin {

    static get requires() {
        return [TodoListMultistateEditing, TodoListMultistateUI, TodoListMultistateToolbar, TodoListMultistateAutoformat] as const;
    }

}
