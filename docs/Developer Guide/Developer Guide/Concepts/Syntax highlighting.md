# Syntax highlighting
## Defining the MIME type

The first step to supporting a new language for either code blocks or code notes is to define the MIME type. Go to `mime_type.ts` in `packages/commons` and add a corresponding entry:

```
{ title: "ABAP (SAP)", mime: "text/x-abap", mdLanguageCode: "abap" }
```

Where `mdLanguageCode` is a Markdown-friendly name of the language.

## Syntax highlighting for Highlight.js

The Highlight.js instance in Trilium identifies the code to highlight by the mime type mappings defined in `syntax_highlighting.ts` in `packages/highlightjs`.

There are three possible cases, all involving modifying the `byMimeType` record:

### Highlight.js built-in languages:

Simply add a corresponding entry:

```
"application/dart": () => import("highlight.js/lib/languages/dart"),
```

### External modules from NPM

1.  Install the module as a dependency in `packages/highlight.js`
2.  Import:
    
    ```
    "application/x-cypher-query": () => import("highlightjs-cypher")
    ```
3.  Do this if the npm module is relatively new and it has TypeScript mappings, if not see the last option.

### Modules integrated directly into Trilium

*   Allows making small modifications if needed (especially if the module is old).
*   Works well for modules missing type definitions, since types are added directly in code.

Steps:

1.  Copy the syntax highlighting file ([example](https://github.com/highlightjs/highlightjs-sap-abap/blob/main/src/abap.js)) into `packages/highlightjs/src/languages/[code].ts`.
2.  Add a link in a comment at the top of the file linking to the original source code.
3.  Replace `module.exports =` by `export default`.
4.  Add types to the method:
    
    ```
    import { HLJSApi, Language } from "highlight.js";
    
    export default function (hljs: HLJSApi): Language {
        // [...]
    }
    ```
5.  Remove any module loading mechanism or shims outside the main highlight function.
6.  Modify `syntax_highlighting.js` to support the new language:
    
    ```
    "text/x-abap": () => import("./languages/abap.js"),
    ```

## Syntax highlighting for CodeMirror

> [!NOTE]
> Newer versions of Trilium use CodeMirror 6, so the plugin must be compatible with this version.

### Adding the MIME type mapping

Similar to Highlight.js, the mappings for each MIME type are handled in `syntax_highlighting.ts` in `packages/codemirror`, by modifying the `byMimeType` record.

1.  Official modules:
    
    ```
    async () => (await import('@codemirror/lang-html')).html(),
    ```
2.  Legacy modules (ported from CodeMirror 5):
    
    ```
    "text/turtle": async () => (await import('@codemirror/legacy-modes/mode/turtle')).turtle, 
    ```
3.  Modules integrated into Trilium:
    
    ```
    "application/x-bat": async () => (await import("./languages/batch.js")).batch,
    ```

### Integrating existing modules

*   Add a comment at the beginning indicating the link to the original source code.
*   Some imports might require updating:
    *   Instead of  
        `import { StreamParser, StringStream } from "@codemirror/stream-parser";`, use    
        `import { StreamParser, StringStream } from "@codemirror/language";`