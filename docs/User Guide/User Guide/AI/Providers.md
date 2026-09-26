# Providers
## Cloud providers using API keys

Currently, the following cloud providers are supported:

*   [Anthropic](https://platform.claude.com/settings/workspaces/default/keys)
*   OpenAI
*   Gemini
*   DeepSeek

For all the providers, an API key is needed. Note that this is charged separately from the subscription you might already have (e.g. Claude Pro). If that might be a problem, consider using either a subscription provider (see below) or using it externally via MCP.

Do note that most other LLM providers (e.g. OpenRouter, Groq, Mistral) can still be used in Trilium via the OpenAI-compatible custom endpoint (see below).

If you are using a proxy or gateway, you can also configure the base URL, otherwise the default will be used.

> [!NOTE]
> We don't plan to support all cloud providers, even if the library we are using would theoretically support them. Before opening a PR adding support for a different cloud provider, make sure to discuss it over [GitHub Discussions](https://github.com/orgs/TriliumNext/discussions).

> [!IMPORTANT]
> See also the dedicated <a class="reference-link" href="Privacy.md">Privacy</a> section to better understand what data is being sent to a cloud provider.

## Subscription-based providers

Trilium integrates multiple <a class="reference-link" href="Providers/Subscription-based%20providers.md">Subscription-based providers</a>:

*   Claude Code by reusing your CLI.
*   GitHub Copilot by reusing your CLI's ACP.
*   Google Antigravity by downloading and setting up an ACP for Trilium.
*   OpenAI Codex by reusing your CLI through an ACP adapter shipped with Trilium.

## Local/self-hosted providers

Local or self-hosted providers are a free alternative which respects your privacy but requires specific hardware.

Trilium directly supports the following local providers:

*   Ollama
    *   Generally Ollama runs in the background so it should be directly usable in Trilium as long as the models are downloaded (e.g. `ollama pull llama3.2`).
*   LM Studio
    *   The OpenAI-compatible server is **disabled** by default in LM Studio installations. First download your desired models through the graphical interface, then go to _Settings_ → _Developer_ and toggle _Developer mode_. On the left there will be a new _Developer_ tab, with a toggle to start it up.

Even for local providers that are not directly supported by Trilium, you can still use a custom endpoint (see below).

> [!WARNING]
> When dealing with self-hosted LLM models, depending on the training and the size of the model, the quality of the output may vary. Before [reporting issues](../Troubleshooting/Reporting%20issues.md) regarding the quality of the output (e.g. hallucinating tool calls), consider benchmarking the response against a cloud provider (Claude Sonnet is recommended).

## Custom endpoints

If your desired hosted (e.g. OpenRouter, Groq, Mistral) or local LLM provider is not listed in Trilium, you can use the dedicated _OpenAI-compatible_ provider from the _Custom endpoint_ section.

This allows you to set the base URL to an OpenAI-compatible API, with an optional API key if required by the service.

Enter the base URL exactly as the service documents it, including its version path, such as `https://api.groq.com/openai/v1` or `https://open.bigmodel.cn/api/paas/v4`. Only a bare host such as `http://localhost:8080` is completed with `/v1`.

For custom endpoints, the pricing of the models is not known so the cost of a conversation will not be displayed; this is especially relevant for hosted providers.

Trilium refuses endpoints that resolve into address ranges nothing is ordinarily served on — notably `100.64.0.0/10`, the range a Tailscale tailnet uses.

> [!NOTE]
> If your custom endpoint is only reachable over a tailnet, set the `TRILIUM_SAFE_FETCH_ALLOWLIST` environment variable on the machine running Trilium to a comma-separated list of the IPv4 addresses or CIDRs it may contact anyway (e.g. `TRILIUM_SAFE_FETCH_ALLOWLIST=100.83.121.222`), and restart Trilium. Only AI endpoint calls honor the list, and only addresses inside the Tailscale range can be allowed; entries must be dotted-quad IPv4 addresses or CIDRs, and anything else (an IPv6 address, a hostname) is ignored and logged. Prefer exact addresses over broad CIDRs: a `/10` entry also covers cloud metadata endpoints such as `100.100.100.200`.