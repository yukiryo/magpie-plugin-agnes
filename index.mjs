import { mediaRequest } from "./media.mjs"

const ID = "agnes"
const BASE = "https://apihub.agnes-ai.com/v1"
const SDK = "@ai-sdk/openai-compatible"
const ORIGIN = new URL(BASE).origin
const RETIRED = new Set(["agnes-2.0-flash", "agnes-2.5-pro-alpha"])
const CHAT = {
  "agnes-2.5-flash": { name: "Agnes 2.5 Flash", context: 512000, output: 65500 },
  "agnes-2.5-pro-beta": { name: "Agnes 2.5 Pro Beta", context: 1000000, output: 65536 },
  "agnes-2.5-pro": { name: "Agnes 2.5 Pro", context: 1000000, output: 65536 },
  "agnes-3.0-flash": { name: "Agnes 3.0 Flash", context: 512000, output: 65536 },
}
const LEGACY = {
  "agnes-1.5-flash": { name: "Agnes 1.5 Flash", context: 262144, output: 65536 },
}
const BOOT_IDS = [
  "agnes-2.5-flash", "agnes-2.5-pro-beta", "agnes-3.0-flash",
  "agnes-image-2.0-flash", "agnes-image-2.1-flash", "agnes-image-2.5-flash",
  "agnes-video-2.5", "agnes-video-2.5-flash",
]

function row(id) {
  const chat = CHAT[id]
  const text = chat ?? LEGACY[id]
  const image = id.startsWith("agnes-image-")
  const video = id.startsWith("agnes-video-")
  const input = text || image ? ["text", "image"] : video ? ["text", "image", "audio", ...(id.endsWith("-flash") ? [] : ["video"])] : ["text"]
  const output = image ? ["image"] : video ? ["video"] : ["text"]
  return {
    id,
    name: text?.name ?? id.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" "),
    limit: { context: text?.context ?? 0, output: text?.output ?? 0 },
    reasoning: !!chat,
    tool_call: !!chat,
    attachment: input.includes("image"),
    modalities: { input, output },
    capabilities: {
      reasoning: !!chat,
      toolcall: !!chat,
      attachment: input.includes("image"),
      input: Object.fromEntries(input.map((kind) => [kind, true])),
      output: Object.fromEntries(output.map((kind) => [kind, true])),
    },
    ...(chat ? { variants: { none: { reasoningEffort: "none" }, high: { reasoningEffort: "high" } } } : {}),
  }
}

function rows(ids, { config = false } = {}) {
  return Object.fromEntries([...new Set(ids)].filter((id) => !RETIRED.has(id)).map((realId) => {
    // Magpie's OpenAI image picker requires a recognized images-API id.
    const publicId = realId.startsWith("agnes-image-") ? realId.replace("agnes-image-", "gpt-image-agnes-") : realId
    return [publicId, { ...row(realId), id: config ? realId : publicId, api: { id: realId, url: BASE, npm: SDK } }]
  }))
}
const isKey = (auth) => auth?.type === "api" && typeof auth.key === "string" && auth.key.trim().length > 0
const refused = (status) => Object.assign(new Error(`Agnes refused this API key (HTTP ${status}); sign in again`), { signIn: "expired" })
const errorResponse = (message, status) => Response.json({ error: { message, type: "invalid_request_error" } }, { status })

async function apiGet(fetchImpl, path, key) {
  return fetchImpl(new Request(`${BASE}/${path}`, {
    headers: { authorization: `Bearer ${key.trim()}`, accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  }))
}

function modelIds(body) {
  if (!Array.isArray(body?.data) || body.data.some((model) => typeof model?.id !== "string" || !model.id.trim())) {
    throw new Error("Agnes returned an invalid model list")
  }
  return body.data.map((model) => model.id)
}

async function chatRequest(request) {
  if (new URL(request.url).pathname !== "/v1/chat/completions" || request.method !== "POST") return request
  let body
  try {
    body = await request.clone().json()
  } catch {
    return request
  }
  if (typeof body?.reasoning_effort !== "string") return request
  const effort = body.reasoning_effort
  if (!["none", "minimal", "low", "medium", "high", "xhigh", "max"].includes(effort)) return request
  // Agnes exposes a thinking switch rather than graded reasoning efforts.
  body.chat_template_kwargs = { ...body.chat_template_kwargs, enable_thinking: effort !== "none" }
  delete body.reasoning_effort
  const headers = new Headers(request.headers)
  headers.delete("content-length")
  headers.set("content-type", "application/json")
  return new Request(request, { headers, body: JSON.stringify(body) })
}

function createFetch(getAuth, fetchImpl) {
  return async (input, init) => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    if (url.origin !== ORIGIN || !url.pathname.startsWith("/v1/")) {
      return errorResponse("The Agnes provider only sends requests to its official API", 400)
    }
    const auth = await getAuth()
    if (!isKey(auth)) return errorResponse("Sign in with an Agnes API key first", 401)
    const headers = new Headers(request.headers)
    headers.set("authorization", `Bearer ${auth.key.trim()}`)
    headers.delete("x-api-key")
    headers.delete("cookie")
    const signed = new Request(request, { headers, redirect: "error" })
    const media = await mediaRequest(signed, { fetchImpl })
    return media ?? fetchImpl(await chatRequest(signed))
  }
}

function createPlugin({ fetchImpl = globalThis.fetch } = {}) {
  return {
    async config(config) {
      config.provider ??= {}
      config.provider[ID] ??= {
        name: "Agnes AI", npm: SDK, api: BASE,
        env: ["AGNES_API_KEY"], models: rows(BOOT_IDS, { config: true }),
      }
    },

    auth: {
      provider: ID,
      methods: [{ type: "api", label: "Agnes API Key", placeholder: "Paste your Agnes API key" }],
      async loader(getAuth) {
        const auth = await getAuth()
        if (!isKey(auth)) return {}
        return { baseURL: BASE, apiKey: auth.key.trim(), fetch: createFetch(getAuth, fetchImpl) }
      },
      async usage(getAuth) {
        const auth = await getAuth()
        if (!isKey(auth)) return {}
        try {
          // /models is public for any non-empty Bearer, so it cannot validate a key.
          const response = await apiGet(fetchImpl, "dashboard/billing/subscription", auth.key)
          if (response.status === 401 || response.status === 403) return { error: refused(response.status).message, signIn: "expired", windows: [] }
          if (!response.ok) return { error: `Agnes answered HTTP ${response.status}`, windows: [] }
          const body = await response.json()
          if (!body || typeof body !== "object" || Array.isArray(body) || body.error || body.success === false) {
            return { error: "Agnes returned an unsuccessful key check", windows: [] }
          }
          // The billing fields are undocumented for Agnes; do not invent a quota.
          return { plan: "Agnes API", windows: [] }
        } catch {
          return { error: "Could not verify the Agnes API key; check the connection and try again", windows: [] }
        }
      },
    },

    provider: {
      id: ID,
      async models(provider, { auth } = {}) {
        if (!isKey(auth)) return provider.models
        let response
        try {
          response = await apiGet(fetchImpl, "models", auth.key)
        } catch {
          return provider.models
        }
        if (response.status === 401 || response.status === 403) throw refused(response.status)
        if (!response.ok) return provider.models
        let body
        try {
          body = await response.json()
        } catch {
          throw new Error("Agnes returned an invalid model list")
        }
        return rows(modelIds(body))
      },
    },
  }
}

// Magpie invokes every exported function, so test helpers stay in one object.
export const AgnesPlugin = async (input = {}) => createPlugin(input)
export const _internal = { createPlugin }
