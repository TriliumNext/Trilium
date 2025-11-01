# Exporting HTML for web publishing
As described in <a class="reference-link" href="../Sharing.md">Sharing</a>, Trilium can act as a public server in which the shared notes are displayed in read-only mode. While this can work in most cases, it's generally not meant for high-traffic websites and since it's running on a Node.js server it can be potentially exploited.

Another alternative is to generate static HTML files (just like other static site generators such as [MkDocs](https://www.mkdocs.org/)). Since the normal HTML ZIP export does not contain any styling or additional functionality, Trilium provides a way to export the same layout and style as the <a class="reference-link" href="../Sharing.md">Sharing</a> function into static HTML files.

Apart from the enhanced security, these HTML files are also easy to deploy on “serverless” deployments such as GitHub Pages or CloudFlare Pages and cache very easily.

> [!TIP]
> Trilium's documentation, available at [docs.triliumnotes.org](https://docs.triliumnotes.org/) is built using this function of exporting to static HTML files which are then deployed automatically to CloudFlare Pages.
> 
> The process is [automated](https://github.com/TriliumNext/Trilium/blob/main/apps/edit-docs/src/build-docs.ts) by importing the Markdown documentation and exporting it via a script to the static web format.

## Differences from normal sharing

Apart from normal <a class="reference-link" href="../Sharing.md">Sharing</a>, exporting to static HTML files comes with a few subtle differences:

*   The URL structure is different. Where in normal sharing it's something along the way of `example.com/share/noteid`, the notes follow an hierarchical structure, such as `docs.triliumnotes.org/user-guide/concepts/navigation/tree-concepts`.
*   The `favicon.ico` is not handled automatically, it needs to be manually added on the server after the export is generated.
*   The “Last updated” for notes is not available.
*   The search functionality works slightly different since the normal one requires an active API to work. In the static export, search still works but uses a different mechanism so results might be different.

## Differences from normal .zip export

*   The name of the files/URLs will prefer `shareAlias` to allow for clean URLs.
*   The export requires a functional web server as the pages will not render properly if accessed locally via a web browser due to the use of module scripts.

## Testing locally

As mentioned previously, the exported static pages require a website to function. In order to test locally, a web server needs to be used.

One example is to use the Node.js-based [`http-server`](https://www.npmjs.com/package/http-server) which can be installed via:

```
npm i -g http-server
```

Once installed simply:

1.  Extract the exported .zip file.
2.  Inside the extracted directory, run `http-server`.
3.  Access the indicated address (e.g. [http://localhost:8080](http://localhost:8080)).

## Automation

<a class="reference-link" href="../ETAPI%20(REST%20API).md">ETAPI (REST API)</a> could potentially be used to automate an export on a scheduled task.