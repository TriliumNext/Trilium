# System Requirements
*   Using Docker, the server can be run on Windows, Linux and macOS devices.
*   Native binaries are provided for Linux x64 and ARM (`aarch64`).

## Legacy ARM support

The Docker builds also provide `linux/arm/v7` and `linux/arm/v8` platforms. These platforms are considered legacy since Trilium uses Node.js version 24 which have [officially downgraded support](https://github.com/nodejs/node/commit/6682861d6f) for these platforms to “experimental”.

As a result, Trilium needs to use Node.js 22 for these versions. As soon as soon Node.js 22 will no longer be compatible, support for `armv7` and `armv8` will be dropped entirely.

Regardless of upstream support, these platforms are supported on a best-effort basis and are not officially supported by the Trilium development team. Bug reports are accepted but they will not be treated with priority; contributions are welcome.