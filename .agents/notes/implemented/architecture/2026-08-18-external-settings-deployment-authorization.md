# Agent Note: deployment authorization for external settings namespaces

Status: implemented

English | [中文](2026-08-18-external-settings-deployment-authorization.zh.md)

## Problem

An external plugin that owned browser settings had to change the API gateway's product allowlist. A plugin declaration alone would let composed code expand a deployment's browser configuration access, while a deployment list alone could expose a plugin whose owner never reviewed its schema for client use. The existing value redactor also could not prove that a secret behind every schemastery structure had been removed before a descriptor crossed the wire.

## Decision

`SettingsRegisterOptions.exposeToClients` is an owner opt-in that defaults to `false`; `ctx.settings.isExposedToClients(ns)` returns it only while the owner registration is live. `ApiProxyService.Config.exposedSettingsNamespaces` is a deployment list that defaults to `[]`, validates lowercase kebab-case namespaces, and deduplicates without requiring a plugin to be mounted at startup.

An external namespace reaches the browser only when it is registered, its owner opted in, its deployment listed it, and `ctx.settings.describeForWire()` returns its descriptor. Existing product namespace rules and the LLM configurable-provider directory remain independent of this external list. Every denied external read or write returns `settings-not-exposed`, including unregistered names, so the API gateway does not provide a registry probe.

`describeForWire()` is the browser descriptor path. It redacts all value layers, removes defaults from secret schema nodes, and omits a namespace when a schema cannot prove that every secret has a supported structural redaction path. Lazy schemas are rejected without executing their builder, because their target is not available in the inspectable graph at the proof point. `redactSecrets()` remains a general value helper and is not sufficient authorization for a browser response. The gateway obtains a safe descriptor before every external write and again before returning its result, so an unsafe schema accepts neither a read nor a browser write.

The wire schema envelope must also be JSON-serializable; cycles and other values that the fetch carrier cannot encode are omitted fail-closed.

## Alternatives considered

- **Plugin opt-in alone** — a plugin loaded by a deployment could make itself browser-configurable without an explicit deployment decision.
- **Deployment list alone** — a deployment could expose a plugin whose author did not approve client access or design its settings for it.
- **Require listed plugins during gateway config validation** — profile layers can name plugins that mount later, so load-time resolution would reject valid compositions.
- **Use `redactSecrets()` as the wire response implementation** — its structural walker deliberately does not cover all schemastery node kinds, which cannot establish that an arbitrary secret was removed.

## Consequences

An external plugin adds no API gateway source change: its Host half declares `exposeToClients: true`, the profile lists its namespace, and its Client half binds `ctx.settingsScope` and contributes its own `settings.plugin.item` card. A deployment can remove the profile entry to withdraw browser access without unloading the plugin, and a plugin unload withdraws its declaration without changing deployment files.

External browser settings must use schemas whose secret fields are structurally safe for `describeForWire()` or expose credential references instead. The same API gateway behavior serves the Web profile and Electron IPC because both consume `ctx.apiProxy`.

## Verification

Settings tests cover the opt-in default, registration lifecycle, redacted descriptors, secret schema defaults, and unsupported secret structures. API gateway tests cover malformed and duplicate deployment entries, both authorization failures, external update/replace/mutate revision handling, and rejection of an authorized union-secret namespace.
