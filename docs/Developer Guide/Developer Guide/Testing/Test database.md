# Test database
The integration tests do not use the same database as `npm run start-server`. Instead, the database is located `integration-tests/db/document.db`.

## In-memory database

Even though we are running our own database, there is still the problem of one test affecting the content for the others or accidentally removing important test notes.

To avoid this, the integration test server (run via `integration-mem-db`) loads the database from `integration-test` into memory and operates from there. That means that any changes done on the integration test server (port 8082) will not be persisted between restarts of the server.

Another benefit of having the database in memory for tests is that they can run in parallel without the risk on interfering with each other.

## How to make changes to the database

As mentioned previously, the database itself can be edited manually in order to add content that is relevant to the tests.

In order to do so, run a separate integration test server with:

```
npm run integration-edit-db
```

This will open up a server on port 8081 which can be used to alter the integration test DB. After finishing the desired changes, it's ideal to close the server to prevent any interferences with further running of tests.

## The database is tracked by Git

This is intentional, meaning that any change to the database will mark the file as changed in Git as well. Some tests require a specific note and it would be too wasteful to have to recreate it via Playwright each time. Instead the content is added manually and then the tests operate directly on the said notes.

In order to make the database easier to track, SQLite WAL was disabled but only for the integration database. This means that only the `.db` file is present and needs to be committed.

## Cleaning up the database

It's recommended to clean up any deleted notes to avoid unnecessary changes being committed. To do so go to Recent Changes in the launcher and select “Erase deleted notes now”.

It's also a good idea to go to Options → Advanced → Vacuum database to clean up it.