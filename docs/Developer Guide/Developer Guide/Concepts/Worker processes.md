# Worker processes
On the server and in the desktop app, Trilium moves CPU-heavy backend work into child processes so that the main process keeps answering requests. Two kinds of work leave the main process: pure content conversions (_content jobs_) and the route-level searches (the _search replica_). Everything that writes stays on the main process.

## Why the work is shaped this way

*   The backend is one Node event loop, and `better-sqlite3` and `getSql().transactional()` are synchronous. A long import, export or search on it blocks every client and the desktop window.
*   Becca (see <a class="reference-link" href="Cache.md">Cache</a>) has no locks and cannot be shared between threads or processes, and a transaction cannot span an `await`.
*   So work leaves the main process only in two forms:
    *   a **pure job**: plain data in, plain data out, no becca, SQL or options;
    *   a **read-only replica** of becca, kept in step by a feed from the main process.
*   Writes, backend scripts and the synchronous script API stay on the main process unchanged.

## The seams in core

`packages/trilium-core` defines three seams, each with an in-process default. The standalone and mobile builds keep the defaults, so they run the same code paths as before.

| Seam | Module | Default | Server implementation |
| --- | --- | --- | --- |
| `ContentJobExecutor` | `services/content_jobs/executor.ts` | Calls `runContentJob()` in the current thread | `createPooledContentJobExecutor()` in `apps/server/src/services/workers/content_job_executor.ts` |
| `SearchExecutor` | `services/search/search_executor.ts` | `inProcessSearchExecutor` | `createReplicaSearchExecutor()` in `apps/server/src/services/search_replica/replica_client.ts` |
| `BeccaReplicaSink` | `services/becca_replica_feed.ts` | None (nothing is fed) | The same replica client |

`initializeCore()` takes the executors as its optional `contentJobs` and `search` parameters. The server implementations come from `createCoreExtensions()` in `apps/server/src/services/core_extensions.ts`, which both boots use: the server's `core_init.ts` and the desktop's `main.ts` (desktop does not boot through `core_init.ts`). After `initializeCore()`, both call `applyPostInit()`, which registers the sink with `setBeccaReplicaSink()` once becca has first loaded. `www.ts` calls `startSearchReplica()` after `markAppReady()`.

## Spawning a worker

`apps/server/src/services/workers/worker_host.ts` is the spawn seam. Every pool goes through `spawnWorker()` and talks to a `WorkerHandle` (`postMessage`, `on("message" | "exit" | "error")`, `kill`, `unref`), so it never sees which primitive started the process.

*   **Server:** the default spawner wraps `child_process.fork()` with `serialization: "advanced"` (structured clone).
*   **Desktop:** `main.ts` calls `setWorkerSpawner(utilityProcessSpawner)` (`apps/desktop/src/services/worker_spawner.ts`) before the core boots. A packaged build sets the `RunAsNode` fuse to `false` in `apps/desktop/electron-forge/flip-fuses.ts`, and `child_process.fork()` cannot start a child without it. `utilityProcess.fork()` works in a packaged build and reads its entry from inside `app.asar`. A bundled `.cjs` entry gets neither loader flags nor `NODE_OPTIONS`.
*   **Processes, never `worker_threads`, for heavy work:** in Electron's main process a worker thread's garbage collector depends on V8 background tasks that never complete, so allocation-heavy jobs wedge it.
*   **Entry resolution:** `resolveWorkerEntry(basename)` tries `<__dirname>/services/<basename>.cjs`, then `<__dirname>/<basename>.cjs`, then `<sourceDir>/<basename>.ts` with the parent's own `execArgv` (running from sources only). The answer, including "none", is cached per basename.
*   **Environment:** `workerEnv()` removes `TRILIUM_START_NOTE_ID` and `TRILIUM_SAFE_MODE`, which make core write options at boot.
*   **Worker side:** `worker_channel.ts` is bundled into every worker. It talks over `process.parentPort` in a utility process and over `process.send` in a forked child. `serveJobs()` announces the worker (with its heap limit) and answers jobs one at a time; a worker sends log lines back to the parent in `logs`, since it has no backend log of its own.

## The pool contract

`createProcessPool()` in `apps/server/src/services/workers/process_pool.ts` runs one job per worker at a time. The image pool (`image_worker_pool.ts`) and the content-job executor are instances of it.

*   **`run()` resolving to `null` means "do it yourself".** The pool answers `null` for good when there is no entry file, a spawn throws, or a worker fails before any worker has ever spoken. The caller then runs the job in its own process.
*   **`everSpoke`** separates "workers do not work here" from "this job failed". Once any worker has sent a message, a later failure rejects only the job it was running; it does not disable the pool.
*   **Retire and replace:** a worker that fails to answer is killed and never reused. If a caller is queued, the pool starts a replacement for it (only when `everSpoke`).
*   **Timeouts:** `bootTimeoutMs` (default 30 s) for the first message; `replyTimeoutMs` per job, which rejects with `WorkerReplyTimeoutError` and retires the worker.
*   **Idle shutdown:** idle workers are killed after `idleShutdownMs`. Every handle is `unref()`'d.
*   **Sizing:** `defaultWorkerCount(heapMb)` uses one core per worker minus one for the main process on desktop, at most `serverMax` (4) on a server, and keeps the workers' heaps within half of the machine's memory.
*   **Tracing:** setting the pool's `traceEnv` variable (for example `TRILIUM_CONTENT_JOB_WORKER_DEBUG`) logs every job.

### Content-job fallback rules

`runPooled()` in `content_job_executor.ts` adds these rules on top of the pool (1 GiB heap per worker, 5 min reply timeout, 30 s idle shutdown):

*   Inputs shorter than `IN_PROCESS_MAX_CHARS` (1024 characters) run in the main process; below that size the round trip costs about as much as the conversion. An `officeToHtml` job always goes to a worker.
*   A pool answer of `null` runs the job in the main process.
*   A job that throws inside a worker comes back as `{ error }` and is rethrown with the same message, because it would throw in the main process too.
*   A worker that crashes mid-job has that job retried once in a fresh worker (`retryInWorker()`), never in the main process: an input that exhausted a worker's heap would freeze or exhaust the main process too. If the retry crashes as well, or no worker can be started for it, the job rejects.
*   A job that hits the reply timeout rejects with `WorkerReplyTimeoutError` and is not retried.

## Content jobs

A content job is a CPU-bound conversion described by plain, structured-clone-safe data. `packages/trilium-core/src/services/content_jobs/jobs.ts` defines the `ContentJob` union and dispatches it with `runContentJob()`. The kinds are `markdownToHtml`, `htmlToMarkdown`, `prettyPrintHtml`, `sanitizeHtml`, `enexNoteContent`, `officeToHtml` and `prepareNoteText`. Callers are the ZIP, ENEX, single-file and Obsidian importers, the ZIP and single-file exporters and the office preview route.

The worker entry `content_job_worker.ts` imports `jobs.ts` by its sub-path, never the core barrel, so its bundle contains the converters and none of becca, SQL or options.

### Adding a content job

1.  Add a variant to `ContentJob`, its result type to `ContentJobResults`, and a handler to `HANDLERS` in `jobs.ts`.
2.  Keep `jobs.ts` and everything it imports free of becca, `getSql()` and options. Pass any setting the conversion reads from the database through `ContentJobEnv` (`env.ts`): the caller captures it once per run with `captureContentJobEnv()`, on the main process.
3.  Give the job a size in `jobSize()` in `content_job_executor.ts`, so small inputs stay in-process.
4.  Call it through `await getContentJobExecutor().run({ kind: …, … })`, never by calling the converter directly. The call site must be async and outside a transaction; do the conversion before `getSql().transactional()` opens.
5.  Add a case to `content_job_fork.spec.ts` that runs the job through a real forked worker and compares it with the in-process result.

## The search replica

The replica is one long-lived worker process (`apps/server/src/services/search_replica/search_replica_worker.ts`) that holds a read-only copy of becca and answers the route-level searches. `replica_client.ts` on the main process is both the `SearchExecutor` and the `BeccaReplicaSink`. The messages are typed in `replica_protocol.ts`.

### What it serves

The query functions live in `packages/trilium-core/src/services/search/search_queries.ts` (plain arguments in, plain JSON out) and run through `executeSearch()`:

| Kind | Route |
| --- | --- |
| `quickSearch` | `GET /api/quick-search` |
| `search` | `GET /api/search` |
| `relatedNotes` | `POST /api/search-related` |
| `searchFromNote` | `GET /api/search-note/:noteId` |
| `searchResultDetails` | `POST /api/search-note/:noteId/result-details` |
| `autocomplete` | `GET /api/autocomplete` |

All other searches stay on the main process: date notes, special notes, the web clipper, `search-and-execute`, backend scripts (`api.searchForNotes`), LLM and MCP tools, ETAPI and share. They search and then write inside one synchronous transaction, or have a synchronous API contract, so they need read-your-writes inside the transaction, which a replica cannot give.

The replica runs with `deferScripts: true`. A saved search with a `~searchScript` relation answers `{ needsMain: true }` instead of running the script, and `executeSearch()` reruns it on the main process.

### Boot

*   The client spawns the replica once becca has loaded and the app is ready, with the database path and the main process's core config in `TRILIUM_SEARCH_REPLICA_OPTIONS`.
*   The replica reads `dbVersion` with a separate read-only connection before core opens the file. On a mismatch it reports `failed` and exits; it never runs migrations.
*   It opens the database read-only, calls `initializeCore()` with `isReadOnly: true`, `General.readOnly` forced on, a no-op backup service, an image provider that throws, and the in-app help provider (so `_help` is searchable). Log lines go to the parent.
*   It announces `ready` with its note count and heap use. Until then, searches run in the main process.

### The feed

The database is in WAL mode, so the replica's connection sees every committed row. The feed only tells it which rows to read again:

*   **Commits:** `ws.sendTransactionEntityChangesToAllClients()` calls `feedCommit()` after every outermost commit with `{ entityName, entityId, isErased }` refs. The replica applies them with `applyEntityChanges()` (`packages/trilium-core/src/becca/becca_follower.ts`), which re-reads the rows and updates becca so that it matches a fresh `becca_loader.load()`. A commit that fails to apply makes the replica load again.
*   **Reloads:** every full `becca_loader.load()` emits `BECCA_RELOADED`, which the sink forwards as `onReload()`. This covers imports (which run with entity events and change ids off, including one that fails partway), a rolled-back transaction that dirtied becca, consistency checks and migrations. A reload inside a transaction is sent at the next commit in place of its changes.
*   **Protected session:** entering sends the data key, and the replica decrypts its protected notes. Leaving sends `null`; the replica resets the key and loads again, with no separate reload message.
*   A feed message that arrives while the replica boots makes it load again once ready.

### Ordering and read-your-writes

Feed messages and queries share one channel and the replica handles them strictly in arrival order. A commit notice is sent before any later search request, so a route search sees every write committed before it was sent. No version counter is needed.

### Fallback and crashes

*   Searches run in the main process while the replica is booting, disabled or being replaced.
*   A query not answered within `QUERY_TIMEOUT_MS` (60 s), a crash, an error, a boot that exceeds `BOOT_TIMEOUT_MS` (10 min) or a message that cannot be sent retires the replica and answers its pending queries in the main process. The first failure spawns a new replica; the second disables it for the life of the process.
*   A query that throws inside the replica (for example a `ValidationError`) crosses back through `serializeSearchQueryError()` and `deserializeSearchQueryError()`, so the route answers with the same status.

### Memory and the `searchWorker` switch

*   The replica holds a second copy of becca. Its heap limit is `replicaHeapMb()`: a quarter of the machine's memory, at most 4096 MB.
*   It is skipped (searches stay in-process) when `searchWorker` is `false` in the `[General]` section of `config.ini` (or `TRILIUM_GENERAL_SEARCHWORKER=false`), when the machine has less than 2 GiB of memory (`MIN_TOTAL_MEMORY_BYTES`), when `TRILIUM_INTEGRATION_TEST` is set, or when no entry file exists.

## Testing

*   **Fake spawner:** specs that test a pool or the replica client call `vi.resetModules()`, import the fresh `worker_host.js`, and register a fake with `setWorkerSpawner()` on that module instance before importing the pool. See `process_pool.spec.ts`, `content_job_executor.spec.ts`, `image_worker_pool.spec.ts` and `replica_client.spec.ts`.
*   **Real processes:** specs that start real workers (`content_job_fork.spec.ts`, `content_job_integrity.spec.ts`, `image_worker_fork.spec.ts`, `search_replica_worker_fork.spec.ts`) start the TypeScript entry, so they add `--import tsx` to `NODE_OPTIONS` for the duration of the spec.
*   **Never import a worker entry at runtime from a spec.** Importing it starts serving on the spec's own process channel. Use `import type` for its types.
*   **Integrity specs:**
    *   `services/import/golden.spec.ts` (core, both runtimes) pins import output and also runs with an executor that finishes jobs out of order; `services/export/concurrent_prepare.spec.ts` exports the same subtree with the in-process executor and with one that finishes jobs out of order, and requires identical archives;
    *   `content_job_integrity.spec.ts` runs a ZIP import and its Markdown and HTML exports with the in-process executor and with real workers and expects identical notes and archives;
    *   `becca_follower.spec.ts` (core, both runtimes) checks that `applyEntityChanges()` leaves becca identical to a fresh load through a seeded run of changes;
    *   `search_replica_worker_fork.spec.ts` runs the real replica against a database file and checks every query against the in-process result, before and after fed writes, reloads and protected-session changes.

## Packaging

*   Each worker entry is its own `buildBackend([...])` call in both `apps/server/scripts/build.ts` and `apps/desktop/scripts/build.ts`, so it lands as `<name>.cjs` beside the bundle: `image_worker`, `content_job_worker` and `search_replica_worker`.
*   A new worker also goes into `WORKER_ENTRIES` in `apps/desktop/scripts/test-packaged.ts`, which fails when an entry is missing from `app.asar`.

## See also

*   <a class="reference-link" href="Cache.md">Cache</a>
*   <a class="reference-link" href="Synchronisation.md">Synchronisation</a>