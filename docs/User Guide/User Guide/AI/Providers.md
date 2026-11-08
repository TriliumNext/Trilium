# Providers
Providers are added in the _Model Providers_ section of the AI settings, with _Add Model Provider_. Each one lists the models selected for it, which are the ones the chat offers; a provider with no models selected is not offered in the chat.

## Cloud providers using API keys

Currently, the following cloud providers are supported:

*   <span class="tn-icon tn-brand tn-brand-anthropic"></span> [Anthropic](https://platform.claude.com/settings/workspaces/default/keys)
*   <span class="tn-icon tn-brand tn-brand-openai"></span> OpenAI
*   <span class="tn-icon tn-brand tn-brand-gemini"></span> Gemini
*   <span class="tn-icon tn-brand tn-brand-deepseek"></span> DeepSeek
*   <span class="tn-icon tn-brand tn-brand-openrouter"></span> [OpenRouter](https://openrouter.ai/settings/keys)

For all the providers, an API key is needed. Note that this is charged separately from the subscription you might already have (e.g. Claude Pro). If that might be a problem, consider using either a subscription provider (see below) or using it externally via MCP.

Do note that most other LLM providers (e.g. Groq, Mistral, Together) can still be used in Trilium via the OpenAI-compatible custom endpoint (see below).

If you are using a proxy or gateway, you can also configure the base URL, otherwise the default will be used.

For OpenRouter, the models are billed to your OpenRouter credits, and their prices, context windows and the attachments they read come from OpenRouter's own model list:

*   The _Latest_ models that can use tools are selected by default, such as _Anthropic: Claude Sonnet Latest_. OpenRouter points each of them at the newest model of its line, so the selection stays current without editing the provider.
*   Models that reason have a reasoning effort dropdown in the chat (_Low_, _Medium_ or _High_).
*   _Auto Router_ (`openrouter/auto`) picks a model for each message. Below each reply, the chat names the model that wrote it, which is also the case when a _Latest_ model was used.
*   The cost shown below a reply is what OpenRouter billed for it, rather than an estimate from the listed prices.
*   Image generation models and the deferred _batch_ variants are not listed.
*   Chat titles are generated with _Anthropic: Claude Haiku Latest_.
*   Requests are attributed to Trilium on your OpenRouter activity page.

For Gemini, a chat that doesn't specify a model uses `gemini-3.8-flash`, and the automatically generated chat titles use `gemini-3.5-flash-lite`. A model you select explicitly is used as is and isn't affected by these defaults.

> [!NOTE]
> We don't plan to support all cloud providers, even if the library we are using would theoretically support them. Before opening a PR adding support for a different cloud provider, make sure to discuss it over [GitHub Discussions](https://github.com/orgs/TriliumNext/discussions).

> [!IMPORTANT]
> See also the dedicated <a class="reference-link" href="Privacy.md">Privacy</a> section to better understand what data is being sent to a cloud provider.

## Subscription-based providers

Trilium integrates multiple <a class="reference-link" href="Providers/Subscription-based%20providers.md">Subscription-based providers</a>:

*   <span class="tn-icon tn-brand tn-brand-claude"></span> Claude Code by reusing your CLI.
*   <span class="tn-icon tn-brand tn-brand-github-copilot"></span> GitHub Copilot by reusing your CLI's ACP.
*   <span class="tn-icon tn-brand tn-brand-antigravity"></span> Google Antigravity by downloading and setting up an ACP for Trilium.
*   <span class="tn-icon tn-brand tn-brand-codex"></span> OpenAI Codex by reusing your CLI through an ACP adapter shipped with Trilium.

## Local/self-hosted providers

Local or self-hosted providers are a free alternative which respects your privacy but requires specific hardware.

Trilium directly supports the following local providers:

=== "<span class="tn-icon tn-brand tn-brand-ollama"></span> Ollama"

    Generally Ollama runs in the background so it should be directly usable in Trilium as long as the models are downloaded (e.g. `ollama pull llama3.2`).

=== "<span class="tn-icon tn-brand tn-brand-lmstudio"></span> LM Studio"

    The OpenAI-compatible server is **disabled** by default in LM Studio installations. First download your desired models through the graphical interface, then go to _Settings_ → _Developer_ and toggle _Developer mode_. On the left there will be a new _Developer_ tab, with a toggle to start it up.

Even for local providers that are not directly supported by Trilium, you can still use a custom endpoint (see below).

> [!WARNING]
> When dealing with self-hosted LLM models, depending on the training and the size of the model, the quality of the output may vary. Before [reporting issues](../Troubleshooting/Reporting%20issues.md) regarding the quality of the output (e.g. hallucinating tool calls), consider benchmarking the response against a cloud provider (Claude Sonnet is recommended).

## Custom endpoints

If your desired hosted (e.g. Groq, Mistral, Together) or local LLM provider is not listed in Trilium, you can use the dedicated _OpenAI-compatible_ provider from the _Custom endpoint_ section.

This allows you to set the base URL to an OpenAI-compatible API, with an optional API key if required by the service.

Enter the base URL exactly as the service documents it, including its version path, such as `https://api.groq.com/openai/v1` or `https://open.bigmodel.cn/api/paas/v4`. Only a bare host such as `http://localhost:8080` is completed with `/v1`.

The endpoint can run on the same machine as Trilium, elsewhere on your local network or on a Tailscale tailnet. Trilium refuses link-local addresses (`169.254.0.0/16`) and cloud metadata endpoints, which no model server is served on.

For custom endpoints, the pricing of the models is not known so the cost of a conversation will not be displayed; this is especially relevant for hosted providers.