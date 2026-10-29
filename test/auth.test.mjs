import assert from "node:assert/strict"
import test from "node:test"
import { _internal } from "../index.mjs"

const key = "test-only-invalid-key"
const getAuth = async () => ({ type: "api", key })

test("a public model catalog never makes an invalid API key look valid", async () => {
  const paths = []
  const hooks = _internal.createPlugin({ fetchImpl: async (input, init) => {
    const request = new Request(input, init)
    const path = new URL(request.url).pathname
    paths.push(path)
    assert.equal(request.headers.get("authorization"), `Bearer ${key}`)
    assert.equal(request.redirect, "error")
    if (path === "/v1/models") return Response.json({ data: [{ id: "agnes-3.0-flash" }] })
    assert.equal(path, "/v1/dashboard/billing/subscription")
    return Response.json({ error: { message: "Invalid token" } }, { status: 401 })
  } })
  const usage = await hooks.auth.usage(getAuth)
  assert.equal(usage.signIn, "expired")
  assert.equal(usage.plan, undefined)
  assert.deepEqual(paths, ["/v1/dashboard/billing/subscription"])
})

test("valid billing authentication does not turn undocumented billing fields into quota", async () => {
  const hooks = _internal.createPlugin({ fetchImpl: async () => Response.json({
    object: "billing_subscription", hard_limit_usd: 999999, soft_limit_usd: 888888,
  }) })
  const usage = await hooks.auth.usage(getAuth)
  assert.equal(usage.signIn, undefined)
  assert.equal(usage.error, undefined)
  assert.equal(usage.plan, "Agnes API")
  assert.deepEqual(usage.windows, [])
  assert.equal(usage.balance, undefined)
})

for (const status of [401, 403]) {
  test(`billing HTTP ${status} identifies a rejected key without echoing its response`, async () => {
    const hooks = _internal.createPlugin({ fetchImpl: async () => Response.json({ error: key }, { status }) })
    const usage = await hooks.auth.usage(getAuth)
    assert.equal(usage.signIn, "expired")
    assert.equal(JSON.stringify(usage).includes(key), false)
  })
}

for (const status of [404, 429, 503]) {
  test(`billing HTTP ${status} reports an unavailable check without expiring the key`, async () => {
    const hooks = _internal.createPlugin({ fetchImpl: async () => Response.json({}, { status }) })
    const usage = await hooks.auth.usage(getAuth)
    assert.equal(usage.signIn, undefined)
    assert.equal(usage.plan, undefined)
    assert.match(usage.error, new RegExp(String(status)))
  })
}

test("network failures in the key check do not disclose secrets or claim a healthy account", async () => {
  const hooks = _internal.createPlugin({ fetchImpl: async () => { throw new Error(`request failed with ${key}`) } })
  const usage = await hooks.auth.usage(getAuth)
  assert.equal(usage.signIn, undefined)
  assert.equal(usage.plan, undefined)
  assert.ok(usage.error)
  assert.equal(JSON.stringify(usage).includes(key), false)
})

test("an unsuccessful JSON payload cannot masquerade as a successful key check", async () => {
  for (const response of [
    new Response("<html>temporary gateway page</html>"),
    Response.json({ success: false, message: key }),
    Response.json({ error: { message: key } }),
    Response.json([]),
  ]) {
    const hooks = _internal.createPlugin({ fetchImpl: async () => response })
    const usage = await hooks.auth.usage(getAuth)
    assert.ok(usage.error)
    assert.equal(usage.plan, undefined)
    assert.equal(usage.signIn, undefined)
    assert.equal(JSON.stringify(usage).includes(key), false)
  }
})

test("a signed-out account never sends a key check", async () => {
  const hooks = _internal.createPlugin({ fetchImpl: () => assert.fail("No key must mean no network call") })
  assert.deepEqual(await hooks.auth.usage(async () => undefined), {})
})
