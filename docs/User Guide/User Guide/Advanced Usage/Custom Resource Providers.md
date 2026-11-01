# Custom Resource Providers
A custom resource provider allows any file imported into Trilium (images, fonts, stylesheets) to be publicly accessible via a URL.

A potential use case for this is to add embed a custom font alongside a theme.

## Steps for creating a custom resource provider

1.  Import a file such as an image or a font into Trilium by drag & drop.
2.  Set the [label](Attributes/Labels.md) `#customResourceProvider` to `hello`.
3.  To test if it is working, use a browser to navigate to `<protocol>://<host>/custom/hello` (where `<protocol>` is either `http` or `https` based on your setup, and `<host>` is the host or IP to your Trilium server instance). If you are running the TriliumNext application without a server, use `http://localhost:37840` as the base URL.
4.  If everything went well, at the previous step the browser should have downloaded the file uploaded in the first step.

Instead of `hello`, the name can be:

*   A path, such as `fonts/Roboto.ttf`, which would be accessible via `<host>/custom/fonts/Roboto.ttf`.
*   As a more advanced use case, a regular expression to match multiple routes, such as `hello/.*` which will be accessible via `/custom/hello/1`, `/custom/hello/2`, `/custom/hello/world`, etc.

## Using it in a theme

For example, if you have a custom font to be imported by the theme, first upload a font file into Trilium and assign it the `#customResourceProvider=fonts/myfont.ttf` attribute.

Then modify the theme CSS to point to:

```css
@font-face {
	font-family: customFont;
	src: url("/custom/fonts/myfont.ttf");
}

div {
	font-family: customFont;
}
```