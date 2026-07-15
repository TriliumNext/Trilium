# Synchronization fails with 504 Gateway Timeout
Synchronization can sometimes take a long amount of time in order to compute the items that require update. When running behind a reverse proxy, the request can time out.

The solution is to increase the timeout at proxy level.

## Nginx

Add the following to the configuration file:

```nginx
proxy_connect_timeout 300;
proxy_send_timeout 300;
proxy_read_timeout 300;
send_timeout 300;
```

And restart the server.

See [Nginx Proxy Setup](../Installation%20%26%20Setup/Server%20Installation/2.%20Reverse%20proxy/Nginx.md) for more information about the Nginx setup.

If it still doesn't work, try increasing the timeout.