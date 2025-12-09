# "New Task" launcher button
In this example we are going to extend the functionality of <a class="reference-link" href="../../../Advanced%20Usage/Advanced%20Showcases/Task%20Manager.md">Task Manager</a> showcase (which comes by default with Trilium) by adding a button in the <a class="reference-link" href="../../../Basic%20Concepts%20and%20Features/UI%20Elements/Launch%20Bar.md">Launch Bar</a>  (![](New%20Task%20launcher%20button_i.png)) to create a new task automatically and open it.

## Creating the note

1.  First, create a new <a class="reference-link" href="../../../Note%20Types/Code.md">Code</a> note type with the _JS frontend_ language.
2.  Define the `#run=frontendStartup` label in <a class="reference-link" href="../../../Advanced%20Usage/Attributes.md">Attributes</a>.

## Content of the script

Copy-paste the following script:

```javascript
api.addButtonToToolbar({
	title: "New task",
    icon: "task",
    shortcut: "alt+n",
    action: async () => {
    	const taskNoteId = await api.runOnBackend(() => {
        	const todoRootNote = api.getNoteWithLabel("taskTodoRoot");
            const resp = api.createTextNote(todoRootNote.noteId, "New task", "")           
            return resp.note.noteId;
        });
        
        await api.waitUntilSynced();
        await api.activateNewNote(taskNoteId);
    }
});
```

## Testing the functionality

Since we set the script to be run on start-up, all we need to do is to [refresh the application](../../../Troubleshooting/Refreshing%20the%20application.md).

## Understanding how the script works

<table class="ck-table-resized"><colgroup><col><col></colgroup><tbody><tr><td><pre><code class="language-application-javascript-env-frontend">api.addButtonToToolbar({
	title: "New task",
    icon: "task",
    shortcut: "alt+n",
    action: async () =&gt; {
    	// [...]
    }
});</code></pre></td><td><p>This uses the <a href="../../Frontend%20Basics.md">Front-end API</a> to create a icon in the&nbsp;<a class="reference-link" href="../../../Basic%20Concepts%20and%20Features/UI%20Elements/Launch%20Bar.md">Launch Bar</a>, by specifying:</p><ul><li>A title</li><li>A corresponding boxicons icon (without the <code>bx-</code> prefix).</li><li>Optionally, a keyboard shortcut to assign to it.</li><li>The action, which will be executed when the button is pressed.</li></ul></td></tr><tr><td><pre><code class="language-application-javascript-env-frontend">const taskNoteId = await api.runOnBackend(() =&gt; {
    // Shown below.           
    return resp.note.noteId;
});</code></pre></td><td><ul><li>This portion of code is actually executed on the server (backend) and not on the client (i.e. browser).<ul><li>The reason is that the creating notes is the responsibility of the server.</li></ul></li><li>Here we can also see that it is possible to return results from the server execution and read them in the client (<code>taskNoteId</code>).</li></ul></td></tr><tr><td><pre><code class="language-application-javascript-env-frontend">const todoRootNote = api.getNoteWithLabel("taskTodoRoot");</code></pre></td><td><ul><li>Here we identify a note with the <a href="../../../Advanced%20Usage/Attributes.md">label</a> <code>#taskTodoRoot</code>. This is how the&nbsp;<a class="reference-link" href="../../../Advanced%20Usage/Advanced%20Showcases/Task%20Manager.md">Task Manager</a>&nbsp;showcase knows where to place all the different tasks.</li><li>Normally this might return a <code>null</code> value if no such note could be identified, but error handling is outside the scope of this example.&nbsp;</li></ul></td></tr><tr><td><pre><code class="language-application-javascript-env-frontend">const resp = api.createTextNote(todoRootNote.noteId, "New task", "")</code></pre></td><td><ul><li>We create a new child note within the to-do root note (first argument) with the title “New task" (second argument) and no content by default (third argument).</li></ul></td></tr><tr><td><pre><code class="language-application-javascript-env-frontend">await api.waitUntilSynced();</code></pre></td><td><ul><li>Back on the client, since we created a new note on the server, we now need to wait for the change to be reflected in the client.</li></ul></td></tr><tr><td><pre><code class="language-application-javascript-env-frontend">await api.activateNewNote(taskNoteId);</code></pre></td><td><ul><li>Since we know the <a href="../../../Advanced%20Usage/Note%20ID.md">ID</a> of the newly created note, all we have to do now is to show this note to the user.</li></ul></td></tr></tbody></table>