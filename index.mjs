// Agnes AI (agnes-ai.com) for OpenCode and magpie.
//
// Agnes serves an OpenAI-compatible API at https://apihub.agnes-ai.com/v1:
// an API key from platform.agnes-ai.com signs every request
// (Authorization: Bearer), chat completions serve the text models, and
// GET /v1/models lists the models a key may use (wiki.agnes-ai.com,
// github.com/AgnesAI-Labs/AgnesAI-Models MODEL_CATALOG.md). Agnes meters
// requests per plan and publishes no balance endpoint, so the usage hook
// reports only the sign-in state; spend and quota live in the platform
// console. Agnes's image models serve /v1/images/generations and refuse a
// chat request naming it (#1837), which magpie follows: a row marked an
// image model is drawn with there, never chatted with.

const ID = "agnes"
const BASE = "https://apihub.agnes-ai.com/v1"

// Documented text-model limits, from MODEL_CATALOG.md (2026-07-30): 512K
// context and a 65.5K output reference limit for 2.5, 256K and 64K for the
// others (2.0's temporary 1M context was rolled back in June 2026). Image
// models draw, and keep no token windows (0).
const LIMITS = {
  "agnes-2.5-flash": { context: 524288, output: 67072 },
  "agnes-2.0-flash": { context: 262144, output: 65536 },
  "agnes-1.5-flash": { context: 262144, output: 65536 },
}

// The models the catalog documents, plus the ones the hub's own public
// /v1/models answers (2026-10-29) that the catalog's text doesn't: the
// 2.5 Pro and 3.0 pair and the third image model. A model the catalog
// gives no limits for keeps none (0), and serves text alone — 2.5 Pro is
// a text model on Artificial Analysis's index, and an unlisted id is
// never sent what it can't read. 1.5 takes an image URL but the catalog
// gives it neither tool calling nor reasoning: a chat model only. The
// image models take text and image and give images, which is the marking
// magpie draws by (their id reads as an images-API model, and the row
// says input.image and an output of image): they are asked at the images
// API, so they show under Settings › Images and to generate_image, and
// never as chat models.
const BOOT_MODELS = [
  "agnes-2.5-flash",
  "agnes-2.0-flash",
  "agnes-1.5-flash",
  "agnes-2.5-pro-alpha",
  "agnes-2.5-pro-beta",
  "agnes-3.0-flash",
  "agnes-image-2.0-flash",
  "agnes-image-2.1-flash",
  "agnes-image-2.5-flash",
]
const CHAT_ONLY = new Set(["agnes-1.5-flash"])

// Readable names for the models the hub serves; an id the vendor lists
// beyond them is prettied instead.
const NAMES = {
  "agnes-2.5-flash": "Agnes 2.5 Flash",
  "agnes-2.0-flash": "Agnes 2.0 Flash",
  "agnes-1.5-flash": "Agnes 1.5 Flash",
  "agnes-2.5-pro-alpha": "Agnes 2.5 Pro Alpha",
  "agnes-2.5-pro-beta": "Agnes 2.5 Pro Beta",
  "agnes-3.0-flash": "Agnes 3.0 Flash",
  "agnes-image-2.0-flash": "Agnes Image 2.0 Flash",
  "agnes-image-2.1-flash": "Agnes Image 2.1 Flash",
  "agnes-image-2.5-flash": "Agnes Image 2.5 Flash",
}

// pretty turns an id the NAMES table lacks into a display name: the part
// after any org slash, separators spaced, each word's first letter raised.
function pretty(id) {
  const tail = id.split("/").pop().replace(/[-_]+/g, " ").trim()
  return tail.replace(/(^|\s)\w/g, (m) => m.toUpperCase())
}

// isVideo is whether an id is one of Agnes's video models: they serve an
// async videos API (POST /v1/videos, then poll by video_id), which this
// plugin doesn't speak, so such an id stays out of the list rather than
// stand there as a text model that can't chat.
function isVideo(id) {
  return /video/i.test(id)
}

// isImage is whether an id makes images: Agnes's own (agnes-image-*), and
// the image models of vendors Agnes relays (gpt-image-*, *-image), which
// all read by their name the way magpie's own lists read.
function isImage(id) {
  return /image/i.test(id)
}

// Text models the catalog documents as reading images: 2.5 and 2.0
// ("image understanding") and 1.5 ("image URL input"). An id the catalog
// doesn't list is read as text alone, so a new model is never sent what
// it can't see.
const IMAGE_INPUT = new Set(["agnes-2.5-flash", "agnes-2.0-flash", "agnes-1.5-flash"])

// The row carries the fields both readers use: the config hook reads the
// top-level ones, the models hook reads the capabilities object. An image
// row is marked a drawer by input.image said and an output naming image,
// and carries no reasoning or tools to be asked for in chat. A text row
// reads images where the catalog says it does, and gives text.
function row(id, name, limit, chatOnly) {
  const image = isImage(id)
  const reads = image || IMAGE_INPUT.has(id)
  const tools = !image && !chatOnly
  return {
    id,
    name,
    limit: limit ?? { context: 0, output: 0 },
    reasoning: tools,
    tool_call: tools,
    modalities: {
      input: reads ? ["text", "image"] : ["text"],
      output: [image ? "image" : "text"],
    },
    capabilities: {
      reasoning: tools,
      toolcall: tools,
      attachment: reads,
      input: { text: true, image: reads },
      output: { text: !image, image },
    },
  }
}

// rows for the model ids an account may use: limits and names from the
// catalog table where it lists one, a text-only row where it doesn't.
function rowsFor(ids) {
  return Object.fromEntries(
    ids
      .filter((id) => !isVideo(id))
      .map((id) => [id, row(id, NAMES[id] ?? pretty(id), LIMITS[id], CHAT_ONLY.has(id))]),
  )
}

// accountModels lists the model ids a key may use. Agnes answers
// {"object":"list","data":[{"id":…}]} like every OpenAI-compatible server.
async function accountModels(fetchImpl, key) {
  return await fetchImpl(`${BASE}/models`, {
    headers: { authorization: `Bearer ${key}`, accept: "application/json" },
    signal: AbortSignal.timeout(15000),
    redirect: "error",
  })
}

// keyCheck asks the one-api-shaped billing endpoint, the one place the hub
// refuses a key it doesn't know: /v1/models answers the public catalog to
// any non-empty Bearer, so it can't tell a good key from a bad one.
async function keyCheck(fetchImpl, key) {
  return await fetchImpl(`${BASE}/dashboard/billing/subscription`, {
    headers: { authorization: `Bearer ${key}`, accept: "application/json" },
    signal: AbortSignal.timeout(15000),
    redirect: "error",
  })
}

function createPlugin({ fetchImpl = globalThis.fetch } = {}) {
  return {
    config: async (cfg) => {
      cfg.provider ??= {}
      // `??=` keeps a provider the user configured in plugins.json.
      cfg.provider[ID] ??= {
        name: "Agnes AI",
        npm: "@ai-sdk/openai-compatible", // chat completions
        api: BASE,
        models: rowsFor(BOOT_MODELS),
      }
    },

    auth: {
      provider: ID,
      methods: [{ type: "api", label: "Agnes API key" }],
      // magpie sends `Authorization: Bearer <apiKey>` for
      // @ai-sdk/openai-compatible; no custom fetch is needed, and the host
      // applies the account's proxy to every request.
      async loader(getAuth) {
        const auth = await getAuth()
        if (auth?.type !== "api" || !auth.key) return {}
        return { baseURL: BASE, apiKey: auth.key }
      },
      // Agnes meters per plan and publishes no balance reading this
      // plugin can vouch for (the billing endpoint's fields are the
      // one-api shape's, but what Agnes makes of them isn't documented),
      // so this only checks the sign-in at the one endpoint that refuses
      // a key, and says where spend is visible. A key Agnes refuses
      // marks the account (signIn: "expired").
      async usage(getAuth) {
        const auth = await getAuth()
        if (auth?.type !== "api" || !auth.key) return {}
        let res
        try {
          res = await keyCheck(fetchImpl, auth.key)
        } catch (error) {
          return { error: `Agnes unreachable: ${error?.cause?.code || error?.message || "network error"}`, windows: [] }
        }
        if (res.status === 401 || res.status === 403) {
          return { error: `Agnes refused this key (HTTP ${res.status}); sign in again`, signIn: "expired", windows: [] }
        }
        if (!res.ok) return { error: `Agnes answered HTTP ${res.status}`, windows: [] }
        return { plan: "Agnes API", windows: [] }
      },
    },

    provider: {
      id: ID,
      async models(provider, { auth } = {}) {
        if (auth?.type !== "api" || !auth.key) return provider.models
        let res
        try {
          res = await accountModels(fetchImpl, auth.key)
        } catch {
          // A network failure keeps the previous list, like a non-2xx answer.
          return provider.models
        }
        if (res.status === 401 || res.status === 403) {
          throw Object.assign(new Error(`Agnes refused this key (HTTP ${res.status}); sign in again`), { signIn: "expired" })
        }
        if (!res.ok) return provider.models
        let body
        try {
          body = await res.json()
        } catch {
          throw new Error("Agnes sent no model list")
        }
        // A malformed answer keeps the previous list (the host marks it a
        // fallback); an empty one is the account's list, as its key has no
        // models, and replaces the bootstrap rows the way a live catalog does.
        if (!Array.isArray(body?.data) || body.data.some((m) => typeof m?.id !== "string" || !m.id)) {
          throw new Error("Agnes sent no model list")
        }
        return rowsFor(body.data.map((m) => m.id))
      },
    },
  }
}

// The plugin is the only exported function; magpie calls every exported
// function as a plugin, so tests reach the internals through this object.
export const AgnesPlugin = async (input) => createPlugin(input)
export const _internal = { createPlugin, row, pretty, rowsFor, LIMITS, BOOT_MODELS, BASE }
