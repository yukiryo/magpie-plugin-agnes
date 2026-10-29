import assert from "node:assert/strict"
import test from "node:test"

const module = await import("../index.mjs").catch((error) => {
  if (error.code !== "ERR_MODULE_NOT_FOUND") throw error
  return {}
})

const key = "test-key-not-a-real-credential"
const auth = async () => ({ type: "api", key })
const json = (body, status = 200) => Response.json(body, { status })

test("registers one native provider with distinct chat, image, and video capabilities", async () => {
  assert.equal(typeof module.AgnesPlugin, "function", "the native provider is missing")
  const hooks = await module.AgnesPlugin({})
  const config = {}
  await hooks.config(config)
  const provider = config.provider.agnes
  assert.equal(provider.npm, "@ai-sdk/openai-compatible")
  assert.equal(provider.api, "https://apihub.agnes-ai.com/v1")
  assert.equal(hooks.auth.provider, "agnes")
  assert.equal(hooks.auth.methods[0].type, "api")
  const chat = provider.models["agnes-3.0-flash"]
  assert.equal(chat.tool_call, true)
  assert.equal(chat.reasoning, true)
  assert.deepEqual(chat.modalities, { input: ["text", "image"], output: ["text"] })
  assert.equal(chat.limit.context, 512000)
  assert.equal(chat.limit.output, 65536)
  assert.deepEqual(provider.models["gpt-image-agnes-2.5-flash"].modalities.output, ["image"])
  assert.equal(provider.models["gpt-image-agnes-2.5-flash"].tool_call, false)
  assert.equal(provider.models["gpt-image-agnes-2.5-flash"].id, "agnes-image-2.5-flash")
  assert.deepEqual(provider.models["agnes-video-2.5-flash"].modalities.output, ["video"])
  assert.equal(provider.models["agnes-2.5-pro-alpha"], undefined)
  assert.equal(provider.models["agnes-3.0-pro"], undefined)
  assert.equal(Object.values(module).filter((value) => typeof value === "function").length, 1)
})

test("preserves an existing provider configuration", async () => {
  const hooks = await module.AgnesPlugin({})
  const existing = { name: "My Agnes", models: {} }
  const config = { provider: { agnes: existing } }
  await hooks.config(config)
  assert.equal(config.provider.agnes, existing)
  assert.deepEqual(await hooks.auth.loader(async () => undefined), {})
})

test("discovers account models, drops retired models, and accepts newly available models", async () => {
  const hooks = module._internal.createPlugin({ fetchImpl: async (request) => {
    assert.equal(request.url, "https://apihub.agnes-ai.com/v1/models")
    assert.equal(request.headers.get("authorization"), `Bearer ${key}`)
    assert.equal(request.redirect, "error")
    return json({ object: "list", data: [
      { id: "agnes-3.0-flash" }, { id: "agnes-2.5-pro-alpha" },
      { id: "agnes-2.5-pro" }, { id: "new-model" },
    ] })
  } })
  const models = await hooks.provider.models({ models: {} }, { auth: await auth() })
  assert.deepEqual(Object.keys(models), ["agnes-3.0-flash", "agnes-2.5-pro", "new-model"])
  assert.equal(models["agnes-2.5-pro"].limit.context, 1000000)
  assert.equal(models["new-model"].tool_call, false)
  assert.deepEqual(models["new-model"].modalities.input, ["text"])
})

test("advertises images in Magpie's drawing picker and maps their public ids to the real API id", async () => {
  const hooks = module._internal.createPlugin({ fetchImpl: async () => json({ data: [{ id: "agnes-image-2.5-flash" }] }) })
  const models = await hooks.provider.models({ models: {} }, { auth: await auth() })
  assert.deepEqual(Object.keys(models), ["gpt-image-agnes-2.5-flash"])
  const image = models["gpt-image-agnes-2.5-flash"]
  assert.equal(image.id, "gpt-image-agnes-2.5-flash")
  assert.deepEqual(image.api, { id: "agnes-image-2.5-flash", url: "https://apihub.agnes-ai.com/v1", npm: "@ai-sdk/openai-compatible" })
  assert.equal(image.name, "Agnes Image 2.5 Flash")
})

test("a still-available legacy chat model keeps its image input without fabricated reasoning or tools", async () => {
  const hooks = module._internal.createPlugin({ fetchImpl: async () => json({ data: [{ id: "agnes-1.5-flash" }] }) })
  const models = await hooks.provider.models({ models: {} }, { auth: await auth() })
  const model = models["agnes-1.5-flash"]
  assert.deepEqual(model.modalities.input, ["text", "image"])
  assert.equal(model.tool_call, false)
  assert.equal(model.reasoning, false)
  assert.equal(model.limit.context, 262144)
})

test("keeps prior models on temporary failures and honors an explicitly empty catalog", async () => {
  const previous = { kept: { id: "kept" } }
  for (const fetchImpl of [async () => { throw new TypeError("offline") }, async () => json({}, 503)]) {
    const hooks = module._internal.createPlugin({ fetchImpl })
    assert.equal(await hooks.provider.models({ models: previous }, { auth: await auth() }), previous)
  }
  const hooks = module._internal.createPlugin({ fetchImpl: async () => json({ data: [] }) })
  assert.deepEqual(await hooks.provider.models({ models: previous }, { auth: await auth() }), {})
})

test("distinguishes rejected credentials and malformed catalogs from a healthy empty account", async () => {
  for (const status of [401, 403]) {
    const hooks = module._internal.createPlugin({ fetchImpl: async () => json({ error: "denied" }, status) })
    await assert.rejects(hooks.provider.models({ models: {} }, { auth: await auth() }), (error) => error.signIn === "expired" && !error.message.includes(key))
    const usage = await hooks.auth.usage(auth)
    assert.equal(usage.signIn, "expired")
    assert.deepEqual(usage.windows, [])
  }
  for (const body of [{ data: [{ id: "" }] }, { data: {} }, { success: false }, { data: [{ id: 42 }] }]) {
    const hooks = module._internal.createPlugin({ fetchImpl: async () => json(body) })
    await assert.rejects(hooks.provider.models({ models: {} }, { auth: await auth() }), /model list/i)
  }
})

test("reports key validity without inventing an account balance", async () => {
  const hooks = module._internal.createPlugin({ fetchImpl: async () => json({ data: [{ id: "agnes-3.0-flash" }] }) })
  const usage = await hooks.auth.usage(auth)
  assert.deepEqual(usage.windows, [])
  assert.equal(usage.error, undefined)
  assert.equal(usage.signIn, undefined)
  assert.equal(usage.balance, undefined)
  assert.deepEqual(await hooks.auth.usage(async () => undefined), {})
})

test("forwards streaming tool events immediately and reads the current key for each call", async () => {
  let current = key
  const encoder = new TextEncoder()
  let finish
  const stream = new ReadableStream({ start(controller) {
    controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"lookup","arguments":"{}"}}]}}]}\n\n'))
    finish = () => controller.close()
  } })
  const seen = []
  const hooks = module._internal.createPlugin({ fetchImpl: async (request) => {
    seen.push(request.headers.get("authorization"))
    assert.equal(request.headers.get("x-api-key"), null)
    assert.equal(request.headers.get("cookie"), null)
    return new Response(stream, { headers: { "content-type": "text/event-stream" } })
  } })
  const loader = await hooks.auth.loader(async () => ({ type: "api", key: current }))
  current = "a-refreshed-test-key"
  const response = await loader.fetch("https://apihub.agnes-ai.com/v1/chat/completions", {
    method: "POST", headers: { "content-type": "application/json", "x-api-key": "caller-key", cookie: "private=1" },
    body: JSON.stringify({ model: "agnes-3.0-flash", stream: true, messages: [] }),
  })
  const first = await response.body.getReader().read()
  assert.equal(first.done, false)
  assert.match(new TextDecoder().decode(first.value), /"tool_calls"/)
  assert.deepEqual(seen, ["Bearer a-refreshed-test-key"])
  finish()
})

test("translates explicit thinking choices without dropping tools or caller template settings", async () => {
  for (const [effort, enabled] of [["none", false], ["high", true]]) {
    const hooks = module._internal.createPlugin({ fetchImpl: async (request) => json(await request.json()) })
    const loader = await hooks.auth.loader(auth)
    const response = await loader.fetch("https://apihub.agnes-ai.com/v1/chat/completions", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "agnes-3.0-flash", messages: [], tools: [{ type: "function", function: { name: "lookup" } }], reasoning_effort: effort, chat_template_kwargs: { custom: "keep" } }),
    })
    const body = await response.json()
    assert.deepEqual(body.chat_template_kwargs, { custom: "keep", enable_thinking: enabled })
    assert.equal(body.reasoning_effort, undefined)
    assert.equal(body.tools[0].function.name, "lookup")
  }
})

test("does not send credentials to a different origin and preserves request cancellation", async () => {
  let calls = 0
  const hooks = module._internal.createPlugin({ fetchImpl: async (request) => {
    calls++
    assert.equal(request.signal.aborted, true)
    return json({})
  } })
  const loader = await hooks.auth.loader(auth)
  const denied = await loader.fetch("https://other.example/v1/models")
  assert.equal(denied.status, 400)
  assert.equal(calls, 0)
  const controller = new AbortController()
  controller.abort()
  await loader.fetch("https://apihub.agnes-ai.com/v1/models", { signal: controller.signal })
  assert.equal(calls, 1)
})
