# Nginx Proxy Manager (for testing reverse proxy setups)

## Quick start

1. Start Trilium on the host (default port 8080):
   ```bash
   pnpm run server:start
   ```

2. Start Nginx Proxy Manager:
   ```bash
   docker compose up -d
   ```

3. Open the NPM admin panel at **http://localhost:8081** and log in with:
   - Email: `admin@example.com`
   - Password: `changeme`
   (You'll be asked to change these on first login.)

4. Add a proxy host:
   - **Domain Names**: `localhost`
   - **Scheme**: `http`
   - **Forward Hostname / IP**: `host.docker.internal`
   - **Forward Port**: `8080`
   - Enable **Websockets Support** (required for Trilium sync)

5. Access Trilium through NPM at **http://localhost:8090**.

## With a subpath

To test Trilium behind a subpath (e.g. `/trilium/`), add a **Custom Nginx Configuration** in NPM under the **Advanced** tab of the proxy host:

```nginx
location /trilium/ {
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_pass http://host.docker.internal:8080/;
    proxy_cookie_path / /trilium/;
    proxy_read_timeout 90;
}
```

## Cleanup

```bash
docker compose down -v
```
