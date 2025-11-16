# Syntax highlighting
## Defining the MIME type

The first step to supporting a new language for either code blocks or code notes is to define the MIME type. Go to `mime_types.ts` and add a corresponding entry:

```
{ title: "Batch file (DOS)", mime: "application/x-bat" }
```

## Syntax highlighting for Highlight.js

### Built-in languages

Highlight.js supports a lot of languages out of the box, for some of them we just need to enable them by specifying one of the language aliases in the `highlightJs` field in the `mime_types` definition:

```
{ title: "Batch file (DOS)", mime: "application/x-bat", highlightJs: "dos" }
```

For the full list of supported languages, see [Supported Languages — highlight.js 11.9.0 documentation](https://highlightjs.readthedocs.io/en/latest/supported-languages.html). Look for the “Package” column to see if another library needs to be installed to support it.

Note that we are using the CDN build which may or may not have all the languages listed as predefined in the “Supported languages” list. To view the real list of supported files, see the `node_modules/@highlightjs/cdn-assets/languages` directory.

### Custom language

When the source code for a language is available, one way is to simply copy it to `libraries/highlightjs/{id}.js` where `id` matches the name for `highlightJs`.

Make sure in the script that the language is registered:

```
hljs.registerLanguage('terraform', hljsDefineTerraform);
```

Then in `mime_types.ts` make sure to set `highlightJsSource` to `libraries` to load it.

```
{ title: "Terraform (HCL)", mime: "text/x-hcl", highlightJs: "terraform", highlightJsSource: "libraries", codeMirrorSource: "libraries/codemirror/hcl.js" },
```

## Syntax highlighting for CodeMirror

### Custom language

Generally new languages are not added in the base installation and need to be separately registered. For CodeMirror 5 it seems that (at least for simple languages), the modes are distributed as _simple modes_ and can generally be copy-pasted in `libraries/codemirror`. An example would be:

```
(() => {

    CodeMirror.defineSimpleMode("batch", {

        start: [],

        echo: []

    });



    CodeMirror.defineMIME("application/x-bat", "batch");

    CodeMirror.modeInfo.push({

        ext: [ "bat", "cmd" ],

        mime: "application/x-bat",

        mode: "batch",

        name: "Batch file"

    });

})();


```

Note that changing `modeInfo` is crucial, otherwise syntax highlighting will not work. The `mime` field is mandatory, even if `mimes` is used instead.

Afterwards, register it in `mime_types.ts`, specifying `codeMirrorSource` to point to the newly created file:

```
{ title: "Batch file (DOS)", mime: "application/x-bat", highlightJs: "dos", codeMirrorSource: "libraries/codemirror/batch.js" }
```