# Traefik
The goal of this article is to configure Traefik proxy and HTTPS. See [#7768](https://github.com/TriliumNext/Trilium/issues/7768#issuecomment-3539165814) for reference.

## Breaking change in Traefik 3.6.4

Traefik 3.6.4 introduced a [breaking change](https://doc.traefik.io/traefik/migrate/v3/#encoded-characters-in-request-path) regarding how percent-encoded characters are handled in URLs. More specifically some URLs used by Trilium (such as `search/%23workspace%20%23!template`) are automatically rejected by Traefik, resulting in HTTP 400 errors.

The easiest solution is to update to Traefik 3.6.7 or later which reverts this configuration change. Alternatively, the configuration can be changed according to the section below.

<details>
    <summary>Configuration change</summary>
    <p>To solve this, the Traefik <a href="https://doc.traefik.io/traefik/getting-started/configuration-overview/#the-install-configuration"><strong>static</strong> configuration</a> must be modified in order to allow those characters:</p>
    <pre><code class="language-text-x-yaml">entryPoints:
  web:
    http:
      encodedCharacters:
        allowEncodedSlash: true
        allowEncodedHash: true</code></pre>
    <aside class="admonition tip"><p>If you still have issues, depending on how Trilium is used (especially regarding search), you might need to enable more encoded character groups. For more information, see <a href="https://github.com/TriliumNext/Trilium/issues/7968">the relevant GitHub issue</a>; feel free to report your findings.</p></aside>
</details>

### Build the docker-compose file

Setting up Traefik as reverse proxy requires setting the following labels:

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

### Setup needed environment variables

After setting up a reverse proxy, make sure to configure the <a class="reference-link" href="Trusted%20proxy.md">Trusted proxy</a>.

### Example `docker-compose.yaml`

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