# Cross-Origin Resource Sharing (CORS)
By default, Trilium cannot be accessed in web browsers by requests coming from other domains/origins than Trilium itself. 

However, it is possible to manually configure [Cross-Origin Resource Sharing (CORS)](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS) since Trilium v0.93.0 using environment variables or `config.ini`, as follows:

| CORS Header | Corresponding option in `config.ini` | Corresponding option in environment variables in the `Network` section |
| --- | --- | --- |
| `Access-Control-Allow-Origin` | `TRILIUM_NETWORK_CORS_ALLOW_ORIGIN` | `corsAllowOrigin` |
| `Access-Control-Allow-Methods` | `TRILIUM_NETWORK_CORS_ALLOW_METHODS` | `corsAllowMethods` |
| `Access-Control-Allow-Headers` | `TRILIUM_NETWORK_CORS_ALLOW_HEADERS` | `corsAllowHeaders` |