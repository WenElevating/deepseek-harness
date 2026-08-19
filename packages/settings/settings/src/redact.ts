/**
 * Structural secret redaction for settings values. The general value walker
 * serves callers that control their schema traversal; `describeForWire()` adds
 * the proof required before a browser receives a descriptor.
 * @module @deepseek-ai/dsh-settings/redact
 */

import type z from '@deepseek-ai/schemastery'

/**
 * Minimal structural view of a live schemastery node. Only the relations the
 * redactor walks are named; everything else on the instance is ignored.
 */
interface SchemaNode {
  type?: string
  meta?: { role?: unknown }
  /** `object` properties, keyed by property name. */
  dict?: Record<string, SchemaNode>
  /** `dict`/`array` element schema. */
  inner?: SchemaNode
}

/** Wire-safe redaction result, including a serialized schema with no secret defaults. */
export interface WireRedactedSchema {
  /** Serialized schema envelope safe for a configuration client. */
  schema: unknown
}

/** One schema-declared secret position inside a redacted value. */
export interface RedactedSecret {
  /** Path from the section root to the removed field (concrete dict keys and array indexes included). */
  path: string[]
  /** Whether the field held a value before redaction. */
  set: boolean
}

/** A value with every `role('secret')` field removed, plus the removal record. */
export interface RedactedValue {
  /** Detached copy of the input with secret fields absent. */
  value: unknown
  /**
   * Every reachable secret position: object properties always (even unset, so
   * a form knows the slot exists), dict entries and array items only where the
   * value has them.
   */
  secrets: RedactedSecret[]
}

/** Whether a value is a plain data object the walker may recurse into. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function walk(node: SchemaNode | undefined, value: unknown, path: string[], secrets: RedactedSecret[]): unknown {
  if (node === undefined) return value
  if (node.meta?.role === 'secret') {
    secrets.push({ path, set: value !== undefined })
    return undefined
  }
  switch (node.type) {
    case 'object': {
      const properties = node.dict ?? {}
      const source = isRecord(value) ? value : undefined
      const rebuilt: Record<string, unknown> = {}
      if (source !== undefined) {
        for (const [key, entry] of Object.entries(source)) {
          if (key in properties) continue
          rebuilt[key] = entry
        }
      }
      for (const [key, child] of Object.entries(properties)) {
        const stripped = walk(child, source?.[key], [...path, key], secrets)
        if (stripped !== undefined) rebuilt[key] = stripped
      }
      return source === undefined && Object.keys(rebuilt).length === 0 ? value : rebuilt
    }
    case 'dict': {
      if (!isRecord(value)) return value
      const rebuilt: Record<string, unknown> = {}
      for (const [key, entry] of Object.entries(value)) {
        const stripped = walk(node.inner, entry, [...path, key], secrets)
        if (stripped !== undefined) rebuilt[key] = stripped
      }
      return rebuilt
    }
    case 'array': {
      if (!Array.isArray(value)) return value
      return value.map((entry, index) => walk(node.inner, entry, [...path, String(index)], secrets))
    }
    default:
      // This general helper leaves unknown structures intact. The browser path
      // calls redactSchemaForWire(), which rejects one if it can reach a secret.
      return value
  }
}

/**
 * Remove every `role('secret')` field a schema declares from a value. The
 * walker follows `object`, `dict`, and `array` containers. It is not a browser
 * safety proof for secrets behind other schema nodes; use
 * `SettingsProvider.describeForWire()` for that path. The input is never
 * mutated.
 * @param schema - live schemastery schema describing the value.
 * @param value - the value to strip; `undefined` yields an empty record with
 *   object-property secret slots still enumerated.
 * @returns the stripped detached value and the ordered secret positions.
 */
export function redactSecrets(schema: z<never>, value: unknown): RedactedValue {
  const secrets: RedactedSecret[] = []
  const stripped = walk(schema, value, [], secrets)
  return { value: stripped, secrets }
}

/** Whether this value is an object or callable schema node with inspectable own fields. */
function isInspectable(value: unknown): value is Record<string, unknown> {
  return (typeof value === 'object' && value !== null) || typeof value === 'function'
}

/** Find a secret role through every inspectable own field of an unsupported node. */
function containsSecretRole(value: unknown, seen = new Set<object>()): boolean {
  if (!isInspectable(value)) return false
  if (seen.has(value)) return false
  seen.add(value)
  const meta = value.meta
  if (isRecord(meta) && meta.role === 'secret') return true
  return Object.values(value).some(child => containsSecretRole(child, seen))
}

/**
 * Prove that the structural redactor covers every declared secret. Unknown
 * schema node kinds remain usable only when their complete inspectable graph
 * contains no secret role at all; lazy nodes are rejected because their
 * builder-backed target cannot be inspected without executing the builder.
 * Otherwise their value never reaches a wire.
 */
function canRedactForWire(node: SchemaNode): boolean {
  if (node.meta?.role === 'secret') return true
  switch (node.type) {
    case 'object':
      return node.dict === undefined
        ? !containsSecretRole(node)
        : Object.values(node.dict).every(child => canRedactForWire(child))
    case 'dict':
    case 'array':
      return node.inner === undefined ? !containsSecretRole(node) : canRedactForWire(node.inner)
    case 'lazy':
      // The builder-backed target is not available in the structural graph
      // until validation or serialization runs it. Reject it rather than
      // executing arbitrary builders or trusting the opaque lazy node.
      return false
    default:
      return !containsSecretRole(node)
  }
}

/** Remove schema defaults from every write-only secret field in a wire envelope. */
function redactSchemaDefaults(value: unknown, seen = new Set<object>()): void {
  if (typeof value !== 'object' || value === null || seen.has(value)) return
  seen.add(value)
  const node = value as Record<string, unknown>
  if (isRecord(node.meta) && node.meta.role === 'secret') delete node.meta.default
  for (const child of Object.values(node)) redactSchemaDefaults(child, seen)
}

/**
 * Produce the schema portion of a settings wire descriptor only when every
 * declared secret has a redaction path. Secret defaults are removed because a
 * schema envelope is also a browser response.
 * @param schema - live schemastery schema for one settings namespace.
 * @returns the safe serialized schema, or `undefined` when the schema cannot be proven safe.
 */
export function redactSchemaForWire(schema: z<unknown>): WireRedactedSchema | undefined {
  try {
    if (!canRedactForWire(schema)) return undefined
    const serialized: unknown = structuredClone(schema.toJSON())
    redactSchemaDefaults(serialized)
    // structuredClone preserves cycles and values such as bigint that the
    // browser response cannot encode, so prove JSON serialization separately.
    if (typeof JSON.stringify(serialized) !== 'string') return undefined
    return { schema: serialized }
  } catch {
    return undefined
  }
}
