import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"))
const mod = await import(new URL(`../${manifest.main}`, import.meta.url))
const exports = Object.values(mod).filter((value) => typeof value === "function")
assert.equal(exports.length, 1, "Magpie invokes every exported function")
const client = { app: { log: async () => {} }, auth: { set: async () => {} }, tui: { showToast: async () => {} } }
const hooks = await exports[0]({ client, directory: process.cwd(), worktree: process.cwd(), project: {} })
assert.equal(hooks.auth.provider, "agnes")
assert.equal(typeof hooks.auth.loader, "function")
assert(hooks.auth.methods.every((method) => method.type === "api"))
const config = { provider: {} }
await hooks.config(config)
assert.equal(config.provider.agnes.npm, "@ai-sdk/openai-compatible")
assert(Object.keys(config.provider.agnes.models).length > 0)
assert.equal(hooks.provider.id, "agnes")
assert.equal(typeof hooks.provider.models, "function")
console.log(`OK: ${manifest.name}@${manifest.version}; native API-key provider; ${Object.keys(config.provider.agnes.models).length} bootstrap models`)
