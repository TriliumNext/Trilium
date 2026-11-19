# Traefik
Цель этой статьи — настроить прокси Traefik и HTTPS. Для справки см. [#7768](https://github.com/TriliumNext/Trilium/issues/7768#issuecomment-3539165814).

## Критическое изменение в Traefik 3.6.4

В Traefik 3.6.4 было внесено [критическое изменение](https://doc.traefik.io/traefik/migrate/v3/#encoded-characters-in-request-path), касающееся обработки символов в процентной кодировке в URL. Trilium включает название изображения или вложения в путь URL, поэтому файл, название которого содержит `#` или `/`, запрашивается по пути вроде `/api/images/…/diagram%231.png`. Traefik отклоняет такие пути с ошибкой HTTP 400, и изображение не загружается. Поиск не затрагивается, поскольку он передаёт текст в параметре запроса.

Самое простое решение — обновиться до Traefik 3.6.7 или более поздней версии, в которой это изменение конфигурации отменено. В качестве альтернативы можно изменить конфигурацию согласно разделу ниже.

<details>
    <summary>Изменение конфигурации</summary>
    <p>Чтобы решить эту проблему, необходимо изменить <a href="https://doc.traefik.io/traefik/getting-started/configuration-overview/#the-install-configuration"><strong>статическую</strong> конфигурацию</a> Traefik, разрешив эти символы:</p>
    <pre><code class="language-text-x-yaml">entryPoints:
  web:
    http:
      encodedCharacters:
        allowEncodedSlash: true
        allowEncodedHash: true</code></pre>
    <aside class="admonition tip"><p>Если изображения всё равно не загружаются, возможно, потребуется разрешить дополнительные группы закодированных символов. Подробнее см. в <a href="https://github.com/TriliumNext/Trilium/issues/7968">соответствующей задаче на GitHub</a>; не стесняйтесь сообщать о своих результатах.</p></aside>
</details>

### Создание файла docker-compose

Для настройки Traefik в качестве обратного прокси необходимо задать следующие метки (labels):

```yaml
    labels:
      - traefik.enable=true
      - traefik.http.routers.trilium.entrypoints=https
      - traefik.http.routers.trilium.rule=Host(`trilium.mydomain.tld`)
      - traefik.http.routers.trilium.tls=true
      - traefik.http.routers.trilium.service=trilium
      - traefik.http.services.trilium.loadbalancer.server.port=8080
      # scheme must be HTTP instead of the usual HTTPS because Trilium listens on HTTP internally
      - traefik.http.services.trilium.loadbalancer.server.scheme=http
      - traefik.docker.network=proxy
      # forward HTTP to HTTPS
      - traefik.http.routers.trilium.middlewares=trilium-headers@docker
      - traefik.http.middlewares.trilium-headers.headers.customrequestheaders.X-Forwarded-Proto=https
```

### Настройка необходимых переменных окружения

После настройки обратного прокси обязательно настройте <a class="reference-link" href="Trusted%20proxy.md">Доверенный прокси</a>.

### Пример `docker-compose.yaml`

```yaml
services:
  trilium:
    image: triliumnext/trilium
    container_name: trilium
    networks:
      - traefik-proxy
    environment:
      - TRILIUM_NETWORK_TRUSTEDREVERSEPROXY=my-traefik-host-ip # e.g., 172.18.0.0/16
    volumes:
      - /path/to/data:/home/node/trilium-data
      - /etc/timezone:/etc/timezone:ro
      - /etc/localtime:/etc/localtime:ro
    labels:
      - traefik.enable=true
      - traefik.http.routers.trilium.entrypoints=https
      - traefik.http.routers.trilium.rule=Host(`trilium.mydomain.tld`)
      - traefik.http.routers.trilium.tls=true
      - traefik.http.routers.trilium.service=trilium
      - traefik.http.services.trilium.loadbalancer.server.port=8080
      # scheme must be HTTP instead of the usual HTTPS because of how trilium works
      - traefik.http.services.trilium.loadbalancer.server.scheme=http
      - traefik.docker.network=traefik-proxy
      # Tell Trilium the original request was HTTPS
      - traefik.http.routers.trilium.middlewares=trilium-headers@docker
      - traefik.http.middlewares.trilium-headers.headers.customrequestheaders.X-Forwarded-Proto=https

networks:
  traefik-proxy:
    external: true
```