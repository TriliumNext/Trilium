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

> [!IMPORTANT]
> Subscription-based providers are still in beta. They are safe to use (they won't use additional funds and respect the terms of use), but you might experience small issues. Consider <a class="reference-link" href="../Troubleshooting/Reporting%20issues.md">Reporting issues</a>.

Some cloud providers offer a subscription, which has a fixed monthly fee instead of pay-per-use (unlike the API keys). Trilium v0.104.0 introduces beta support for Anthropic's Claude Pro/Max subscriptions. Other subscription-based providers such as ChatGPT are on the roadmap, but not yet implemented.

To use a subscription:

1.  First, Claude Code needs to be installed on the machine that runs Trilium. So for a <a class="reference-link" href="../Installation%20%26%20Setup/Desktop%20Installation.md">Desktop Installation</a>, Claude needs to be installed locally and for a <a class="reference-link" href="../Installation%20%26%20Setup/Server%20Installation.md">Server Installation</a> accessed via a browser, Claude needs to be installed on the server.
2.  Claude Code must already be authenticated. To do so, run `claude` in a terminal once, type `/login` and follow the instructions.
3.  Go to <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _AI / LLM_ and add the Claude Code provider.

Trilium will identify your Claude Code binary in this order:

*   By looking for a `TRILIUM_CLAUDE_CODE_PATH` environment variable pointing to the Claude binary. This allows overriding the path if needed.
*   By looking for `claude` in your PATH, generally works in most circumstances.

After your provider is set up, you'll benefit from the same features as an API key (note tools, web search, extended thinking, image/PDF attachments, streaming).

> [!NOTE]
> Trilium intentionally uses your Claude Code binary in order not to have to package a ~250 MB client with it, but this comes at a cost: there is a small risk for a version incompatibility, if the version installed locally doesn't match the one expected by Trilium. Generally it's best to keep both Claude Code and Trilium updated to the latest version.

> [!IMPORTANT]
> See also the dedicated <a class="reference-link" href="Privacy.md">Privacy</a> section to better understand what data is being sent to a cloud provider.

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

For custom endpoints, the pricing of the models is not known so the cost of a conversation will not be displayed; this is especially relevant for hosted providers.