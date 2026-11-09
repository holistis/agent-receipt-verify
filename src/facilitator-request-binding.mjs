// Models, line-for-line against the published reference implementation, what a REMOTE
// facilitator actually receives for a payment-gated request under @x402/core, @x402/express
// and @x402/mcp version 2.30.0 (npm, pinned, fetched 9 November 2026 with `npm pack
// @x402/core@2.30.0 @x402/express@2.30.0 @x402/mcp@2.30.0` and read, not executed).
//
// WHY THIS EXISTS. On x402-foundation/x402 pull request 3776 (section 5.5, the attempt-
// identity invariant we built test/attempt-identity.mjs for), a contributor named
// epistemedeus posted a reproduction on 9 November 2026 showing that a facilitator never
// observes the original query string, body or HTTP method of the request it is verifying
// or settling. We read the real package source ourselves before trusting the claim. This
// module is that reading, made runnable, so the finding stands on the same no-network,
// no-account footing as the rest of this repository instead of on a trust claim about
// someone else's script output.
//
// SCOPE, AND WHAT THIS IS NOT. test/attempt-identity.mjs tests whether an implementation's
// DERIVATION of the attempt identity, from a request snapshot it already has, follows
// section 5.5's text. This module tests something upstream of that: whether the snapshot
// the resource server passes to the facilitator over the wire ever contained the request
// properties section 5.5 assumes are available. The two are deliberately kept in separate
// files and separate vector directories. Mixing them would let a passing attempt-identity
// vector imply a wire-transport guarantee the text does not make, and does not test.
//
// THREE EXACT SOURCE FACTS, each with its file:line, verified 9 November 2026 against the
// real tarball (not a CDN copy, not epistemedeus's quoted excerpt):
//
//   1. Resource URL construction. @x402/core 2.30.0, dist/esm/chunk-U5TAZTKB.mjs, line 2722:
//        url: routeConfig.resource || enrichedContext.adapter.getUrl()
//      A route that configures a fixed `resource` string in its middleware config (the
//      documented, encouraged pattern for a stable, human-readable payment description)
//      replaces the request-derived URL entirely. A route that does not configure one falls
//      back to adapter.getUrl().
//
//   2. What adapter.getUrl() contains. @x402/express 2.30.0, dist/esm/index.mjs, line 54:
//        getUrl() { return `${this.req.protocol}://${this.req.headers.host}${this.req.originalUrl}` }
//      `req.originalUrl` includes the query string. So the AUTO-DERIVED case does carry the
//      query string into the facilitator-visible resource.url. The CONFIGURED case does not,
//      because point 1 discards it before this is ever read.
//
//   3. What actually goes over the wire. @x402/core 2.30.0, dist/esm/chunk-U5TAZTKB.mjs,
//      lines 503-590 (HTTPFacilitatorClient.verify and .settle): the POST body to /verify
//      and /settle is exactly
//        { x402Version, paymentPayload: this.toJsonSafe(paymentPayload), paymentRequirements: this.toJsonSafe(paymentRequirements) }
//      paymentPayload comes from extractPayment() (line 3304), which decodes only the
//      buyer-supplied PAYMENT-SIGNATURE header. Neither the HTTP method nor the request body
//      has a field anywhere in this shape. This is NOT conditional on whether `resource` is
//      configured: there is no code path, in either case, that places method or body on the
//      wire. Point 1's condition only governs the query string, carried solely inside
//      resource.url. Collapsing all three properties into one "configured vs. not" claim
//      would overstate what the source shows for method and body.
//
//   4. A real, shipped instance of the configured-resource case: @x402/mcp 2.30.0,
//      dist/esm/index.mjs, line 92:
//        return `mcp://tool/${toolName}`
//      Every paid MCP tool call's resource.url is built from the tool's NAME alone, never
//      its arguments. This is not a hypothetical configuration choice, it is what the
//      package does unconditionally for every MCP integration, including our own
//      tokenizen/packages/capacity-attest, which depends on @x402/mcp for exactly this.

import { canonicalQuery } from './canonical-request.mjs'

/** What @x402/core line 2722 computes, given a route's config and the raw request. */
export function resourceUrlSeenByFacilitator({ configuredResource, protocol, host, originalUrl }) {
  if (configuredResource) return configuredResource
  return `${protocol}://${host}${originalUrl}`
}

/**
 * The exact wire body @x402/core lines 516-519 / 564-567 send to /verify and /settle.
 * `method` and `body` are accepted as inputs so a vector can show it was never read, not so
 * this function can leak them: neither name appears anywhere below, by design, matching the
 * real schema.
 */
export function facilitatorWireBody({ x402Version, resourceUrl, paymentRequirements, payerSignaturePayload, extra = {} }) {
  return {
    x402Version,
    paymentPayload: {
      ...payerSignaturePayload,
      resource: { url: resourceUrl, ...extra },
    },
    paymentRequirements,
  }
}

/** Order-independent equality over what actually reaches the facilitator. */
export function sameWireBody(a, b) {
  const sort = (v) =>
    Array.isArray(v) ? v.map(sort) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])])) : v
  return JSON.stringify(sort(a)) === JSON.stringify(sort(b))
}

/**
 * Runs one vector: builds both requests' facilitator-visible resource.url and wire body
 * per the three source facts above, and checks the vector's claimed outcome against what
 * the modeled real source actually produces.
 */
export function toetsFacilitatorBinding(vector) {
  const { request_a, request_b, claim } = vector
  const buildUrl = (r) =>
    resourceUrlSeenByFacilitator({
      configuredResource: r.configured_resource ?? null,
      protocol: 'https',
      host: 'seller.example',
      originalUrl: r.path + (r.query ? '?' + canonicalQuery(r.query) : ''),
    })
  const wire = (r) =>
    facilitatorWireBody({
      x402Version: 2,
      resourceUrl: buildUrl(r),
      paymentRequirements: { network: 'eip155:8453', asset: 'USDC' },
      payerSignaturePayload: { fixture: 'never a real authorization' },
    })
  const wireA = wire(request_a)
  const wireB = wire(request_b)
  const identical = sameWireBody(wireA, wireB)
  const expectIdentical = claim === 'collapses-to-same-message'
  return {
    outcome: identical === expectIdentical ? 'PASS' : 'FAIL',
    identical,
    wireA,
    wireB,
  }
}
