# Serving directly the content of a note
When accessing a shared note, Trilium will render it as a web page. Sometimes it's desirable to serve the content directly so that it can be used in a script or downloaded by the user.

| A note displayed as a web page (HTML) | A note displayed as a raw format |
| --- | --- |
| <figure class="image"><img style="aspect-ratio:738/275;" src="1_Serving directly the content of a note_image.png" width="738" height="275"></figure> | ![](Serving%20directly%20the%20content%20of%20a%20note_image.png) |

## By adding an attribute to the note

Simply add the `#shareRaw` attribute and the note will always be rendered _raw_ when accessed from the share URL.

## By altering the URL

Append `?raw` to the URL to display a note in its raw format regardless of whether the `#shareRaw` attribute is added on the note.

![](Serving%20directly%20the%20content%20of%20a%20note_image.png)