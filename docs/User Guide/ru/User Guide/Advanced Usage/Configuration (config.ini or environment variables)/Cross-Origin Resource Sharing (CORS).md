# Cross-Origin Resource Sharing (CORS)
По умолчанию доступ к Trilium из веб-браузеров запросами с других доменов/origin, отличных от самого Trilium, невозможен.

Однако начиная с Trilium v0.93.0 можно вручную настроить [Cross-Origin Resource Sharing (CORS)](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS) с помощью переменных окружения или `config.ini`, как описано ниже:

| Заголовок CORS | Соответствующая переменная окружения | Соответствующая опция в секции `Network` файла `config.ini` |
| --- | --- | --- |
| `Access-Control-Allow-Origin` | `TRILIUM_NETWORK_CORS_ALLOW_ORIGIN` | `corsAllowOrigin` |
| `Access-Control-Allow-Methods` | `TRILIUM_NETWORK_CORS_ALLOW_METHODS` | `corsAllowMethods` |
| `Access-Control-Allow-Headers` | `TRILIUM_NETWORK_CORS_ALLOW_HEADERS` | `corsAllowHeaders` |
