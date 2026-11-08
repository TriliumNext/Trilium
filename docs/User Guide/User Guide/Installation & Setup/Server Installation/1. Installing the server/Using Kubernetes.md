# Using Kubernetes
As Trilium can be run in Docker it also can be deployed in Kubernetes. You can either use our Helm chart, a community Helm chart, or roll your own Kubernetes deployment.

The recommended way is to use a Helm chart.

## Root privileges

By default, the Trilium container starts as root, gives the data directory to UID and GID `1000:1000` and then runs Trilium with those reduced privileges, so no init container is needed to fix the permissions. To use a different UID and GID, set the `USER_UID` and `USER_GID` environment variables.

Starting with v0.107.0, the container can also run without root, which a `restricted` Pod Security Standard requires. Set the user in the pod's security context, and `fsGroup` so that Kubernetes gives the volume to that group:

```yaml
securityContext:
  runAsUser: 1000
  runAsGroup: 1000
  runAsNonRoot: true
  fsGroup: 1000
```

In that mode `USER_UID` and `USER_GID` are ignored. See the section on running as a non-root user in <a class="reference-link" href="Using%20Docker.md">Using Docker</a> for what the data directory needs.

## Helm Charts

[Official Helm chart](https://github.com/TriliumNext/helm-charts) from TriliumNext Unofficial helm chart by [ohdearaugustin](https://github.com/ohdearaugustin): [https://github.com/ohdearaugustin/charts](https://github.com/ohdearaugustin/charts)

## Adding a Helm repository

Below is an example of how

```
helm repo add trilium https://triliumnext.github.io/helm-charts
"trilium" has been added to your repositories
```

## How to install a chart

After reviewing the [`values.yaml`](https://github.com/TriliumNext/helm-charts/blob/main/charts/trilium/values.yaml) from the Helm chart, modifying as required and then creating your own:

```
helm install --create-namespace --namespace trilium trilium trilium/trilium -f values.yaml
```

For more information on using Helm, please refer to the Helm documentation, or create a Discussion in the TriliumNext GitHub Organization.