# Web View
## Configuration

A webview needs to know which URL to render, and it can be provided by setting the `webViewSrc` [label](../Advanced%20Usage/Attributes.md), such as:

```
#webViewSrc="https://www.wikipedia.org"
```

The URL needs to contain the full scheme.

## Web view on the server vs. Electron

When accessing Trilium via a browser instead of the desktop application, the web view will still try to render the content of the desired webpage. However, since it's running in a browser there are quite a few limitations as opposed to the desktop one.

More specifically, quite a few websites oppose being embedded in another website (technically they have a non-permisive `X-Frame-Options` header). This is not bypassable by Trilium so the page will simply fail to render.

You can diagnose this by right clicking the Trilium web page → Inspect (element) and looking in the “Console” tab for errors such as:

*   `Refused to display 'https://www.google.com/' in a frame because it set 'X-Frame-Options' to 'sameorigin'.`
*   `Refused to frame 'https://duckduckgo.com/' because an ancestor violates the following Content Security Policy directive: "frame-ancestors 'self' https://html.duckduckgo.com".`

There are a few websites that do render such as `wikipedia.org`.

Do note that we are also applying some sandboxing constraints on the server side, so if you have any issues other than the unresolvable `X-Frame-Options` described above, feel free to report them.

On the desktop side, a different technology is used which bypasses the constraints of an `iframe` (`webview`).

## Embedding in other note types

Starting with v0.104.0, web views can be embedded into other note types:

*   <a class="reference-link" href="../Collections/Dashboard.md">Dashboard</a>
*   <a class="reference-link" href="Canvas.md">Canvas</a>
*   <a class="reference-link" href="Text.md">Text</a> notes via <a class="reference-link" href="Text/Include%20Note.md">Include Note</a>.