# HTTPS (TLS)
Configuring TLS is essential for [server installation](../Server%20Installation.md) in Trilium. This guide details the steps to set up TLS within Trilium itself.

> [!TIP]
> While Trilium supports HTTPS on its own, it's generally a good idea to use a [reverse proxy](2.%20Reverse%20proxy) instead with TLS termination. You can follow a [guide like this](https://www.digitalocean.com/community/tutorials/how-to-secure-nginx-with-let-s-encrypt-on-ubuntu-20-04) for such setups.

## Obtaining a TLS Certificate

You have two options for obtaining a TLS certificate:

*   **Recommended**: Obtain a TLS certificate signed by a root certificate authority. For personal use, [Let's Encrypt](https://letsencrypt.org) is an excellent choice. It is free, automated, and straightforward. Certbot can facilitate automatic TLS setup.
*   Generate a self-signed certificate. This option is not recommended due to the additional complexity of importing the certificate into all machines connecting to the server.

## Modifying `config.ini`

Once you have your certificate, modify the `config.ini` file in the [data directory](../Data%20directory.md) to configure Trilium to use it:

```
[Network]
port=8080
# Set to true for TLS/SSL/HTTPS (secure), false for HTTP (insecure).
https=true
# Path to the certificate (run "bash bin/generate-cert.sh" to generate a self-signed certificate).
# Relevant only if https=true
certPath=/[username]/.acme.sh/[hostname]/fullchain.cer
keyPath=/[username]/.acme.sh/[hostname]/example.com.key
```

You can also review the [configuration](../../Advanced%20Usage/Configuration%20\(config.ini%20or%20e.md) file to provide all `config.ini` values as environment variables instead. For example, you can configure TLS using environment variables:

```
export TRILIUM_NETWORK_HTTPS=true
export TRILIUM_NETWORK_CERTPATH=/path/to/cert.pem
export TRILIUM_NETWORK_KEYPATH=/path/to/key.pem
```

The above example shows how this is set up in an environment where the certificate was generated using Let's Encrypt's ACME utility. Your paths may differ. For Docker installations, ensure these paths are within a volume or another directory accessible by the Docker container, such as `/home/node/trilium-data/[DIR IN DATA DIRECTORY]`.

After configuring `config.ini`, restart Trilium and access the hostname using "https".

## Self-Signed Certificate

If you opt to use a self-signed certificate for your server instance, note that the desktop instance will not trust it by default.

To bypass this, disable certificate validation by setting the following environment variable (for Linux):

```
export NODE_TLS_REJECT_UNAUTHORIZED=0
trilium
```

Trilium provides scripts to start in this mode, such as `trilium-no-cert-check.bat` for Windows.

**Warning**: Disabling TLS certificate validation is insecure. Proceed only if you fully understand the implications.