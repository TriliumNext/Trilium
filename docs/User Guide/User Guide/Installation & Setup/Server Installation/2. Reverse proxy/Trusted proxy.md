# Trusted proxy
If you are running the Trilium server under a [reverse proxy](../2.%20Reverse%20proxy.md), it's important to configure it as a trusted proxy so that the application can correctly identify the real IP address of the clients. Trilium uses that address for [brute-force protection](../Authentication.md), for the failed sign-in entries in its logs and to detect whether the connection was made over HTTPS.

Without this setting, every request appears to come from the reverse proxy, so all clients share a single limit of failed sign-in attempts.

## Configuring the trusted proxy

To trust the reverse proxy, modify <a class="reference-link" href="../../../Advanced%20Usage/Configuration%20(config.ini%20or%20environment%20variables).md">Configuration (config.ini or environment variables)</a> and set `trustedReverseProxy` to the address the reverse proxy connects to Trilium from:

```
[Network]
trustedReverseProxy=loopback
```

The value is a comma-separated list of IP addresses, subnets in CIDR notation or one of the following names:

| Name | Addresses |
| --- | --- |
| `loopback` | `127.0.0.1/8`, `::1/128` |
| `linklocal` | `169.254.0.0/16`, `fe80::/10` |
| `uniquelocal` | `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `fc00::/7` |

Trilium then reads the client's address from the `X-Forwarded-For` header, taking the right-most entry that does not belong to a trusted address. Entries a client adds to the header are to the left of the ones the proxy appends, so they are ignored.

Common setups:

*   **The reverse proxy runs on the same machine**: use `loopback`.
*   **Trilium runs in Docker, with the reverse proxy on the host or in another container**: use the subnet of the Docker network (for example `172.18.0.0/16`), or `uniquelocal` to cover every Docker network. With the environment variable: `TRILIUM_NETWORK_TRUSTEDREVERSEPROXY=172.18.0.0/16`.
*   **The reverse proxy runs on another machine**: use its IP address.

Only list addresses that the reverse proxy connects from. Any client connecting from a trusted address can claim to be another client through the `X-Forwarded-For` header. This matters for broad values such as `uniquelocal`: if devices on your local network can also reach Trilium directly, use the proxy's exact address instead.

> [!WARNING]
> Avoid setting `trustedReverseProxy=true`. It makes Trilium use the left-most entry of `X-Forwarded-For`, which is the value the client sent, unless the proxy discards the incoming header. Proxies usually append to it instead (such as Nginx's `$proxy_add_x_forwarded_for`), so a client can send a different address with every request and bypass the limit on failed sign-in attempts.

For more information, consult [Express behind proxies](https://expressjs.com/en/guide/behind-proxies.html).