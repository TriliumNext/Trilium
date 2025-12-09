# Reverse proxy configuration
It might be desirable to only expose the share functionality of Trilium to the Internet, and keep the application accessible only within a local network or via VPN.

To do so, a reverse proxy is required.

## Caddy

```
http://domain.com {
  reverse_proxy /share http://localhost:8080/share
}
```

This is for newer versions where the share functionality is isolated, for older versions it's required to also include `/assets`.<sup><a href="#fn2b8mg20aol8">[1]</a></sup>

1.  <sup><strong><a href="#fnref2b8mg20aol8">^</a></strong></sup>
    
    [https://github.com/orgs/TriliumNext/discussions/7341#discussioncomment-14679897](https://github.com/orgs/TriliumNext/discussions/7341#discussioncomment-14679897)