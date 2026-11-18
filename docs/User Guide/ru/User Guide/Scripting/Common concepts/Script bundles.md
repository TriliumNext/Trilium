# Script bundles
For both <a class="reference-link" href="../../Note%20Types/Render%20Note.md">Render Note</a> and more complicated scripts, it's generally useful to split the code into multiple <a class="reference-link" href="../../Note%20Types/Code.md">Code</a> notes.

When a script is run, the sub-children of the script being run (or the <a class="reference-link" href="../../Note%20Types/Render%20Note.md">Render Note</a>) are checked for children. If the children are Code notes of the corresponding type (front-end or backend) as the code being run, they will be evaluated as well.

The collection of a script and its child notes is called a _bundle_. A child note inside a bundle is called a _module_.

As a basic example of dependencies, consider the following note structure:

*   _Script with dependency_
    
    ```javascript
    api.log(MyMath.sum(2, 2));
    ```
    
    *   _MyMath_
        
        ```javascript
        module.exports = {
            sum(a, b) {
                return a + b;
            }
        };
        ```

When _Script with dependency_ is run, it will detect _MyMath_ as a submodule and provide the result of its `module.exports` object into a global object with the same name as the note.

> [!NOTE]
> If the note contains spaces or special characters, they will be stripped. For example `My Nice Note!` becomes `MyNiceNote`.

## Alternative syntax

Instead of providing an object to `module.exports`, it's also possible to add fields individually:

```javascript
module.exports.sum = (a, b) => a + b;
module.exports.subtract = (a, b) => a - b;
```

## Ignoring a code script from a bundle

To ignore a script from being included in a bundle (e.g. if it's unrelated to the parent script note), apply the `#disableInclusion` label.

## Sharing a module across multiple bundles

Modules can be reused across multiple scripts by simply cloning the shared module between two modules (see <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/Notes/Cloning%20Notes.md">Cloning Notes</a>).

Optionally, a separate note can be used to contain all the different reusable modules for an easy way to discover them.