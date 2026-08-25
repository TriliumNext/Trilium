# Server-side imports
Backend scripts can `require()` two kinds of module: an npm package installed into Trilium, and a Node.js built-in.

Backend scripting has to be enabled first — see `backendScriptingEnabled` in the `[Security]` section of `config.ini`, which is off by default.

## npm packages

Open a backend script note (a *JS backend* code note), pick **Script modules** from the note's actions, and install a package by name and version, such as `cheerio@1.1.2`. Trilium fetches it as ES modules and stores it in the database, so it syncs to your other instances and keeps working without network access.

Scripts then require the package by name:

```
const cheerio = require('cheerio');
```

Where several versions of the same package are installed, ask for one by name and version, since the name on its own no longer picks out a single package:

```
const cheerio = require('cheerio@1.1.2');
```

A package is read and evaluated the first time a script requires it, so installed packages that a script does not use cost it nothing.

## Node.js built-ins

Built-in modules are available, except for those that hand a script the machine rather than a library — among them `child_process`, `fs`, `net`, `os`, `path`, `process`, `vm` and `worker_threads`. Requiring one of those fails, however it is spelled: `node:fs` and `fs/promises` are refused the same as `fs`.

## Older versions

Older versions of Trilium resolved `require()` against whatever happened to be in the server's `node_modules` directory, which a bundled build no longer keeps. Install the package from **Script modules** instead.
