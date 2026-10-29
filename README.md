# Agnes AI for Magpie and OpenCode

[Agnes AI](https://agnes-ai.com/) (SapiensAI) with your API key, in
[magpie](https://usemagpie.ai) and OpenCode: text, code and image
generation, through Agnes's OpenAI-compatible API at
`https://apihub.agnes-ai.com/v1`.

> 中文简介：用你自己的 Agnes AI API key，在 Magpie / OpenCode 里使用 Agnes 的文本与图像模型
> （编码代理用 `agnes-2.5-flash`，图像生成用 `agnes-image-2.0/2.1/2.5-flash`）。
> 安装方法见下文「Install in magpie」。

This repository is the plugin package itself: its `package.json` is the
root, so magpie installs it straight from here as the repository stands.

## Install in magpie

The plugin is **unofficial**: nobody has reviewed it but its author, and
magpie says so where it lists it.

1. Magpie → **Plugins › Discover**, scroll to **Unofficial, on GitHub**
   （非官方插件 · GitHub）, find **Agnes AI**, and install it. The list
   comes from GitHub's search, so a repository added recently can take a
   while to show up there.
2. Sign in with an **Agnes API key**: sign up at
   [platform.agnes-ai.com](https://platform.agnes-ai.com/) (email, Google
   or GitHub), create a key in the console's API-keys page, and paste it
   on the plugin's sign-in.
3. Pick a model: `agnes/agnes-2.5-flash` for a coding agent,
   `agnes/agnes-image-2.1-flash` under **Settings › Images**.

OpenCode users add it from git the same way (`magpie plugin add
https://github.com/yukiryo/magpie-plugin-agnes` works there too — the
plugins are OpenCode's), or point `plugin` in `opencode.json` at a local
clone of this folder.

## Models

From Agnes's model catalog
([MODEL_CATALOG.md](https://github.com/AgnesAI-Labs/AgnesAI-Models/blob/main/MODEL_CATALOG.md),
2026-07-30) and the hub's own public `/v1/models` answer, which lists
models the catalog's text doesn't yet:

| Model | What it does |
|---|---|
| `agnes-2.5-flash` | The one for coding agents: 512K context, streaming, tool calling, reasoning, image understanding |
| `agnes-2.0-flash` | The same shape at 256K context, as a compatibility fallback |
| `agnes-2.5-pro-alpha`, `agnes-2.5-pro-beta` | The 2.5 Pro pair (beta is the text model on Artificial Analysis's index); the catalog gives no limits for them yet, so they serve text alone |
| `agnes-3.0-flash` | Newer text model, served text alone until the catalog describes it |
| `agnes-1.5-flash` | Fast chat only: no tool calling, no reasoning; takes an image URL |
| `agnes-image-2.0-flash` | Text-to-image and image-to-image |
| `agnes-image-2.1-flash` | Higher-density generation and image editing, URL or data-URI input |
| `agnes-image-2.5-flash` | Newer image model, in the hub's own list |

After signing in, the plugin replaces this table with whatever
`GET /v1/models` answers, so a model Agnes adds shows up without a new
plugin version. An id the catalog doesn't describe is served as text
alone (or, when `image` is in its name, as an image model), and Agnes's
`agnes-video-*` models stay out: they are an async API this plugin
doesn't speak.

## Image generation

The image rows are marked the way magpie draws by, so in magpie they show
under **Settings › Images** and to `generate_image`, and magpie asks them
at `/v1/images/generations` — including following Agnes's own refusal of a
chat request naming that API (yetone/magpie#1837). OpenCode lists them but
has no drawing surface of its own.

## Usage

Agnes meters requests per plan (a free tier, and Token Plans billed per
request). `/v1/models` answers the public catalog to any non-empty Bearer,
so the usage hook checks the key at the one endpoint that refuses a bad
one — the one-api-shaped `/v1/dashboard/billing/subscription` — and shows
only the sign-in state: the billing fields' meaning under Agnes isn't
documented, so it reads no balance into them. Spend and quota live in the
[platform console](https://platform.agnes-ai.com/). The free tier caps
text models at 30 requests a minute and 1K images at 30 a minute; the
plans raise those (the catalog has the table).

## Tests

```sh
npm test        # node --test; bun test runs them too
```

They call the hooks the way magpie and OpenCode do, with the vendor's
answers faked; they sign in to nothing.

## License

MIT
