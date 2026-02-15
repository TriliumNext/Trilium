# Backend scripts
Unlike [front-end scripts](Frontend%20Basics.md) which run on the client / browser-side, back-end scripts run directly on the Node.js environment of the Trilium server.

Back-end scripts can be used both on a <a class="reference-link" href="../Installation%20%26%20Setup/Server%20Installation.md">Server Installation</a> (where it will run on the device the server is running on), or on the <a class="reference-link" href="../Installation%20%26%20Setup/Desktop%20Installation.md">Desktop Installation</a> (where it will run on the PC).

## Advantages of backend scripts

The benefit of backend scripts is that they can be pretty powerful, for example to have access to the underlying system, for example it can read files or execute processes.

However, the main benefit of backend scripts is that they have easier access to the notes since the information about them is already loaded in memory. Whereas on the client, notes have to be manually loaded first.

## Creating a backend script

Create a new <a class="reference-link" href="../Note%20Types/Code.md">Code</a> note and select the language _JS backend_.

## Running backend scripts

Backend scripts can be either run manually (via the Execute button on the script page), or they can be triggered on certain events.

In addition, scripts can be run automatically when the server starts up, on a fixed time interval or when a certain event occurs (such as an attribute being modified). For more information, see the dedicated <a class="reference-link" href="Backend%20scripts/Events.md">Events</a> page.

## Script API

Trilium exposes a set of APIs that can be directly consumed by scripts, under the `api` object. For a reference of this API, see <a class="reference-link" href="Script%20API/Backend%20API.dat">Backend API</a>.