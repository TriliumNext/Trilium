# Loading data
Data loading can be done in `doRefresh()` since it gets a reference to the note:

```
const blob = await note.getBlob();        
const content = blob.getJsonContent();
```

Note that `doRefresh` can sometimes be called by <a class="reference-link" href="Saving%20data%20via%20spaced%20update.md">Saving data via spaced update</a> when the user makes a changes, this has to be accounted for.