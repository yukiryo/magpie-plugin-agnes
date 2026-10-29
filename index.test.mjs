// Tests for the Agnes AI provider plugin. They call the hooks the way
// magpie and OpenCode do, with the vendor's answers faked, so they sign in
// to nothing. Run them with `node --test` (bun test runs them too).
import test from "node:test"
import assert from "node:assert/strict"

import { AgnesPlugin, _internal } from "./index.mjs"

const BASE = "https://apihub.agnes-ai.com/v1"
const KEY = { type: "api", key: "test-key" }

// fakeFetch answers every call the same way, as the vendor would.
function fakeFetch(status, body) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })
}

async function plugin(fetch) {
  return await AgnesPlugin({ fetchImpl: fetch ?? fakeFetch(200, {}) })
}

test("config declares the agnes provider with a bootstrap model table", async () => {
  const hooks = await plugin()
  const cfg = {}
  await hooks.config(cfg)
  const p = cfg.provider.agnes
  assert.equal(p.name, "Agnes AI")
  assert.equal(p.npm, "@ai-sdk/openai-compatible")
  assert.equal(p.api, BASE)
  for (const id of [
    "agnes-2.5-flash",
    "agnes-2.0-flash",
    "agnes-1.5-flash",
    "agnes-2.5-pro-beta",
    "agnes-image-2.0-flash",
    "agnes-image-2.1-flash",
  ]) {
    assert.ok(p.models[id], `bootstrap table lacks ${id}`)
  }
})

test("a model the catalog doesn't document serves text alone", async () => {
  const hooks = await plugin()
  const cfg = {}
  await hooks.config(cfg)
  const m = cfg.provider.agnes.models["agnes-2.5-pro-beta"]
  assert.equal(m.capabilities.toolcall, true)
  assert.equal(m.capabilities.input.image, false)
})

test("config keeps a provider the user already configured", async () => {
  const hooks = await plugin()
  const cfg = { provider: { agnes: { name: "Mine" } } }
  await hooks.config(cfg)
  assert.equal(cfg.provider.agnes.name, "Mine")
})

test("auth signs in with an API key", async () => {
  const hooks = await plugin()
  assert.equal(hooks.auth.provider, "agnes")
  assert.equal(hooks.auth.methods[0].type, "api")
})

test("loader passes the API key to the AI SDK", async () => {
  const hooks = await plugin()
  const out = await hooks.auth.loader(async () => KEY)
  assert.deepEqual(out, { baseURL: BASE, apiKey: "test-key" })
})

test("loader with no signed-in key yields nothing", async () => {
  const hooks = await plugin()
  const out = await hooks.auth.loader(async () => undefined)
  assert.deepEqual(out, {})
})

// magpie reads capabilities.input.image (a boolean, so it is "said") to
// make a model a drawer, and capabilities.output with "image" to keep it
// out of the chat lists' way: these two are the whole image-model contract.
test("image model rows are marked so magpie draws with them", async () => {
  const hooks = await plugin()
  const cfg = {}
  await hooks.config(cfg)
  const m = cfg.provider.agnes.models["agnes-image-2.1-flash"]
  assert.equal(m.capabilities.input.image, true)
  assert.equal(m.capabilities.output.image, true)
  assert.equal(m.capabilities.output.text, false)
  assert.equal(m.capabilities.toolcall, false)
})

test("agnes-2.5-flash carries the vendor's documented limits and tools", async () => {
  const hooks = await plugin()
  const cfg = {}
  await hooks.config(cfg)
  const m = cfg.provider.agnes.models["agnes-2.5-flash"]
  assert.equal(m.limit.context, 524288)
  assert.equal(m.limit.output, 67072)
  assert.equal(m.capabilities.reasoning, true)
  assert.equal(m.capabilities.toolcall, true)
  assert.equal(m.capabilities.input.image, true)
  assert.equal(m.capabilities.output.image, false)
})

test("agnes-1.5-flash is the chat-only model the catalog documents", async () => {
  const hooks = await plugin()
  const cfg = {}
  await hooks.config(cfg)
  const m = cfg.provider.agnes.models["agnes-1.5-flash"]
  assert.equal(m.capabilities.toolcall, false)
  assert.equal(m.capabilities.input.image, true)
})

test("models hook merges live ids with the bootstrap rows", async () => {
  const hooks = await plugin(
    fakeFetch(200, {
      data: [{ id: "agnes-2.5-flash" }, { id: "agnes-image-2.5-flash" }],
    }),
  )
  const out = await hooks.provider.models({ models: {} }, { auth: KEY })
  assert.ok(out["agnes-2.5-flash"], "live text model missing")
  assert.equal(out["agnes-2.5-flash"].limit.context, 524288)
  // a vendor id the catalog doesn't list yet (#1837) is still known to
  // make images by its name
  assert.equal(out["agnes-image-2.5-flash"].capabilities.input.image, true)
  assert.equal(out["agnes-image-2.5-flash"].capabilities.output.image, true)
})

test("models hook leaves video models out", async () => {
  const hooks = await plugin(
    fakeFetch(200, { data: [{ id: "agnes-2.0-flash" }, { id: "agnes-video-v2.0" }] }),
  )
  const out = await hooks.provider.models({ models: {} }, { auth: KEY })
  assert.ok(out["agnes-2.0-flash"])
  assert.equal(out["agnes-video-v2.0"], undefined)
})

test("models hook with no signed-in key keeps the bootstrap list", async () => {
  const hooks = await plugin()
  const provider = { models: { "agnes-2.5-flash": { name: "kept" } } }
  const out = await hooks.provider.models(provider, {})
  assert.equal(out, provider.models)
})

test("models hook marks an expired key", async () => {
  const hooks = await plugin(fakeFetch(401, {}))
  await assert.rejects(
    () => hooks.provider.models({ models: {} }, { auth: KEY }),
    (err) => err.signIn === "expired",
  )
})

test("models hook keeps the previous list when the vendor's answer is malformed", async () => {
  const hooks = await plugin(fakeFetch(200, { data: "no" }))
  await assert.rejects(
    () => hooks.provider.models({ models: {} }, { auth: KEY }),
    /no model list/,
  )
})

test("models hook keeps the previous list when the vendor is unreachable", async () => {
  const hooks = await plugin(async () => {
    throw new Error("offline")
  })
  const provider = { models: { "agnes-2.5-flash": { name: "kept" } } }
  const out = await hooks.provider.models(provider, { auth: KEY })
  assert.equal(out, provider.models)
})

test("usage hook checks the key against the billing endpoint", async () => {
  let asked
  const hooks = await plugin(async (url) => {
    asked = url
    return { ok: true, status: 200, json: async () => ({}) }
  })
  const out = await hooks.auth.usage(async () => KEY)
  assert.match(asked, /\/v1\/dashboard\/billing\/subscription$/)
  assert.ok(out.plan)
  assert.deepEqual(out.windows, [])
})

test("usage hook marks an expired key", async () => {
  const hooks = await plugin(fakeFetch(401, {}))
  const out = await hooks.auth.usage(async () => KEY)
  assert.equal(out.signIn, "expired")
})

test("usage hook reports a network failure", async () => {
  const hooks = await plugin(async () => {
    throw new Error("offline")
  })
  const out = await hooks.auth.usage(async () => KEY)
  assert.match(out.error, /unreachable/i)
  assert.deepEqual(out.windows, [])
})

test("pretty names the bootstrap rows readably", () => {
  assert.equal(_internal.pretty("agnes-2.5-flash"), "Agnes 2.5 Flash")
  assert.equal(_internal.pretty("agnes-image-2.1-flash"), "Agnes Image 2.1 Flash")
})
