# Server-side imports
Older versions of Trilium Notes allowed the use of Common.js module imports inside backend scripts, such as:

```
const isBetween = require('dayjs/plugin/isBetween')
api.dayjs.extend(isBetween)
```

For newer versions, Node.js imports are **not officially supported anymore**, since we've added a bundler which makes it more difficult to reuse dependencies.

Theoretically it's still possible to use imports by manually setting up a `node_modules` in the server directory via `npm` or `pnpm`.