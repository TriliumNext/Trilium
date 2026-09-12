# Custom AI quick actions
_Quick actions_ are a feature of the <a class="reference-link" href="../In-editor%20AI%20assistant.md">In-editor AI assistant</a> for <a class="reference-link" href="../../Text.md">Text</a> notes which automatically triggers an LLM suggestion based on a defined prompt. The built-in quick actions come with a predefined prompt, but it is also possible to define your own quick actions.

## Creating a custom quick action

In the <a class="reference-link" href="../../../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20Tree.md">Note Tree</a>: 

1.  Right click a note where to place the text snippet.
2.  Select _Insert child note_.
3.  Select _AI Quick Action_.

Afterwards, simply type in the content of the note the desired prompt. The text can be formatted in the same manner as a normal text note and it will be passed to the LLM as Markdown.

The title of the note will become the title of the quick action.

Of note:

*   <a class="reference-link" href="../../Code.md">Code</a> notes work too.
*   An empty note is ignored.
*   <a class="reference-link" href="../../../Basic%20Concepts%20and%20Features/Notes/Archived%20Notes.md">Archived Notes</a> are also excluded.

## Using a quick action

Once a quick action is defined, the actoin will appear under the _Quick Actions_ dropdown in a group called _Custom_.