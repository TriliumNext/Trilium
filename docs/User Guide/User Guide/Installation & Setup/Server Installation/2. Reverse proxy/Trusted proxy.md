# Trusted proxy
If you are running the Trilium server under a [reverse proxy](../2.%20Reverse%20proxy), it's important to configure it as a trusted proxy so that the application can correctly identify the real IP address of the clients (for authentication and rate limiting purposes).

To do so, simply modify <a class="reference-link" href="../../../Advanced%20Usage/Configuration%20(config.ini%20or%20e.md">Configuration (config.ini or environment variables)</a> and set:

```
[Network]
trustedReverseProxy=true
```

This will use the left-most IP in the `X-Forwarded-For` header. Alternatively, instead of `true` use the IP address of the reverse proxy or Express.js shortcuts such as:

```
loopback(127.0.0.1/8, ::1/128), linklocal(169.254.0.0/16, fe80::/10), uniquelocal(10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, fc00::/7)
```

For more information, consult [Express behind proxies](https://expressjs.com/en/guide/behind-proxies.html).