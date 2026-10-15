import type { ProviderRequest } from '@orkestrel/agent'
import { attempt, canonicalStringify } from '@orkestrel/contract'
import { hashStudyBytes } from '../helpers.js'

/**
 * Builds a request revision by hashing its canonical rendering exactly as rendered.
 * @remarks
 * The request is rendered once with key-sorted canonical JSON and hashed as rendered; no
 * newline or JSON round trip is added. Any change to content, order, ids, tools, or options
 * changes the revision.
 * @param request - The exact pre-encoding request
 * @returns The lowercase SHA-256 digest, or undefined when the request cannot be canonically rendered; a rendering failure never throws
 */
export function buildStudyAgentRevision(request: ProviderRequest): string | undefined {
	const rendered = attempt(() => canonicalStringify(request))
	if (!rendered.success || rendered.value === undefined) return undefined
	return hashStudyBytes(rendered.value)
}
