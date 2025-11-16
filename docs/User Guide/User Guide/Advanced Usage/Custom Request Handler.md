# Custom Request Handler
Trilium provides a mechanism for [scripts](../Scripting.md) to open a public REST endpoint. This opens a way for various integrations with other services - a simple example would be creating new note from Slack by issuing a slash command (e.g. `/trilium buy milk`).

## Create note from outside Trilium

Let's take a look at an example. The goal is to provide a REST endpoint to which we can send title and content and Trilium will create a note.

We'll start with creating a JavaScript backend [code note](../Note%20Types/Code.md) containing:

```
const {req, res} = api;
const {secret, title, content} = req.body;

if (req.method == 'POST' && secret === 'secret-password') {
    // notes must be saved somewhere in the tree hierarchy specified by a parent note. 
    // This is defined by a relation from this code note to the "target" parent note
    // alternatively you can just use constant noteId for simplicity (get that from "Note Info" dialog of the desired parent note)
    const targetParentNoteId = api.currentNote.getRelationValue('targetNote');
    
    const {note} = api.createTextNote(targetParentNoteId, title, content);
    const notePojo = note.getPojo();

    res.status(201).json(notePojo);
}
else {
    res.send(400);
}
```

This script note has also following two attributes:

*   label `#customRequestHandler` with value `create-note`
*   relation `~targetNote` pointing to a note where new notes should be saved

### Explanation

Let's test this by using an HTTP client to send a request:

```
POST http://your-trilium-server/custom/create-note
Content-Type: application/json

{
  "secret": "secret-password",
  "title": "hello",
  "content": "world"
}+++++++++++++++++++++++++++++++++++++++++++++++
```

Notice the `/custom` part in the request path - Trilium considers any request with this prefix as "custom" and tries to find a matching handler by looking at all notes which have `customRequestHandler` [label](Attributes.md). Value of this label then contains a regular expression which will match the request path (in our case trivial regex "create-note").

Trilium will then find our code note created above and execute it. `api.req`, `api.res` are set to [request](https://expressjs.com/en/api.html#req) and [response](https://expressjs.com/en/api.html#res)objects from which we can get details of the request and also respond.

In the code note we check the request method and then use trivial authentication - keep in mind that these endpoints are by default totally unauthenticated, and you need to take care of this yourself.

Once we pass these checks we will just create the desired note using [Script API](../Scripting/Script%20API.md).

## Custom resource provider

Another common use case is that you want to just expose a file note - in such case you create label `customResourceProvider` (value is again path regex).

For more information, see [Custom Resource Providers](Custom%20Resource%20Providers.md).

## Advanced concepts

`api.req` and `api.res` are Express.js objects - you can always look into its [documentation](https://expressjs.com/en/api.html) for details.

### Parameters

REST request paths often contain parameters in the URL, e.g.:

```
http://your-trilium-server/custom/notes/123
```

The last part is dynamic so the matching of the URL must also be dynamic - for this reason the matching is done with regular expressions. Following `customRequestHandler` value would match it:

```
notes/([0-9]+)
```

Additionally, this also defines a matching group with the use of parenthesis which then makes it easier to extract the value. The matched groups are available in `api.pathParams`:

```
const noteId = api.pathParams[0];
```

Often you also need query params (as in e.g. `http://your-trilium-server/custom/notes?noteId=123`), you can get those with standard express `req.query.noteId`.