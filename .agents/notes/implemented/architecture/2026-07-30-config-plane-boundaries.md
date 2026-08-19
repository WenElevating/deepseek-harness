# Agent Note: what the configuration plane exposes, and who may overwrite what

Status: implemented

English | [中文](2026-07-30-config-plane-boundaries.zh.md)

> Scope: boundary hardening of the [web configuration plane](2026-07-30-web-config-plane.md) — which namespaces reach the wire, which callers reach them, and how an editor holding a partial, possibly stale view writes without destroying what it cannot see.

> The caller boundary, the redaction, and the revision fencing remain current. Restricting which namespaces reach the wire to the configurable-provider directory is superseded by the [plugin-owned settings surface](2026-08-12-plugin-owned-settings-surface.md), which serves every registered namespace.

## Problem

The plane worked and was reachable by more callers, and with more authority, than its design claimed.

`trustedHosts` gated only writes, so a declared LAN client could call `settings.describe` — every exposed namespace's configuration — and `credentials.describe`, which reports whether an arbitrary environment-variable name is configured and where it resolves from. That fence is a DNS-rebinding defense and says so; treating it as an authorization boundary for reads was a category error. Separately, the proxy served every registered namespace: the settings seam is deliberately general, so the first plugin to call `settings.register()` for its own configuration would silently become remotely readable and writable, without passing anywhere near a review of the web surface.

The editor was worse than reachable — it was destructive. It reads the redacted descriptor, which by construction omits `role('secret')` fields. Clearing one field rebuilt the whole user section from that redacted copy and sent `settings.replace`, so a stored literal `apiKey` the wire had never returned was deleted as a side effect. Reproduced directly: `{baseURL, reasoning}` in, `apiKey` gone. Row removal took the same path. And nothing carried a version, so two tabs editing one namespace silently overwrote each other; the seam's per-namespace write queue orders writes but cannot tell a fresh writer from one replaying a stale snapshot.

Three smaller defects sat beside them. `llm/adapters-updated` documented contained observer failures but only caught synchronous ones, so an async listener's rejection escaped as an unhandled rejection. llm-deepseek's retry-policy swap disposed its registration before re-registering, publishing an empty route set between the two — an observer saw the provider disappear and come back, despite a comment claiming no such window. And a transport rejection during the page's credential enrichment escaped `load()`, stranding the page in `loading` with no error shown.

## Decision

**Reading configuration is as privileged as writing it.** `settings.describe` and `credentials.describe` join the loopback-only set, so the whole configuration plane stays same-origin until real authentication exists. The model catalog (`llm.providers`, `llm.models`) deliberately does not: it carries provider ids, display names, and model lists — no endpoints, no key state — and a LAN client's model picker needs it. The boundary is asserted over a real HTTP server rather than a hand-assembled request, because the `Host` header a browser actually sends is what decides it.

**The plane serves model-provider namespaces, fixed product namespaces, and deployment-authorized external namespaces.** `ctx.llm.listConfigurableProviders()` remains the allow-list for provider configuration, while product-owned sections retain their fixed rules. An external namespace must have a live `exposeToClients: true` registration, appear in the API gateway's `exposedSettingsNamespaces` deployment list, and produce a safe `describeForWire()` descriptor. An unregistered namespace and every failed authorization answer identically (`settings-not-exposed`), so probing cannot enumerate the registry. The deployment-controlled extension is recorded in [the external settings authorization note](2026-08-18-external-settings-deployment-authorization.md).

**A caller with a partial view names the field it means.** `SettingsProvider.mutate(ns, ops)` applies `set`/`unset` path ops to the section as it stands at the front of the write queue. The client builds ops by diffing its opening snapshot against its draft, so it mentions only fields it can see: a secret absent from both sides produces no op and survives by construction, not by care. `replace` remains the deliberate wholesale reset.

**Staleness is detected, not ordered away.** Each namespace carries a monotonic `revision` over its RAW section; writes may carry `expectedRevision`, and a mismatch rejects with `SettingsConflictError` → `settings-conflict` on the wire, both revisions attached. The editor captures the revision it opened at and, on conflict, tells the user to reopen rather than replaying its snapshot.

**The raw layer gets its own event.** `settings/updated` stays gated on the resolved value — that is what a consumer means by change. `settings/document-updated (ns, revision)` fires on any raw-section change, because a configuration surface must learn that a field went from inherited to overridden (same resolved value, different meaning) and that its held revision is stale. The event is forwarded verbatim, and model consumers subscribe to it alongside `llm/adapters-updated`, because provider settings hold catalog data that no route change announces.

## Alternatives considered

- **A deployment-declared namespace allowlist without an owner declaration** — this would give deployment config authority to expose a plugin whose author never approved a browser configuration path. The list remains one required half of external authorization, while provider and product namespaces keep their own rules.
- **Opt-in metadata at `settings.register()` without a deployment allowlist** — this would let any composed plugin enlarge browser configuration access. The owner declaration is necessary but cannot grant deployment authority by itself.
- **Distinguishing "unregistered" from "registered but unexposed"** — better diagnostics, and a namespace-enumeration oracle. The uniform answer is deliberate.
- **Detecting conflicts by diffing instead of a revision** — comparing the submitted base against storage would work for whole-section writes, but the editor holds a REDACTED section: it cannot produce a comparable base, which is the same reason it cannot safely `replace`. A counter needs neither.
- **Treating `redactSecrets` as the browser safety proof** — it walks only `object`/`dict`/`array`, so a secret behind a union, intersection, or transform can be missed. `describeForWire()` therefore admits unsupported structures only when their inspectable graph contains no secret role, removes secret defaults, and otherwise omits the whole namespace; the gateway refuses the corresponding writes.

## Consequences

A LAN client on a `trustedHosts` deployment can no longer render the settings page at all; loopback is the configuration surface. A plugin that registers a settings namespace is not web-configurable unless it is a configurable provider, is product-owned, or satisfies the external double authorization; `settings-not-exposed` names every denied state. `SettingsDescriptor` carries a required `revision`, so any programmatic constructor of a descriptor-shaped value must supply it, and `settings/document-updated` is a new event any provider-side listener may now observe. Clients that ignore `expectedRevision` keep last-write-wins semantics unchanged. Browser descriptors now fail closed when a schema cannot prove secret redaction safety; a non-executable browser schema protocol remains outside this decision.
