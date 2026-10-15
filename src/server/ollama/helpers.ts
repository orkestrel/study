import type { JSONValue } from '@orkestrel/contract'
import type { OllamaTiming } from '@orkestrel/ollama'
import type { StudyRole, StudyRoom } from '../../core/types.js'
import type {
	StudyOllamaRequest,
	StudyOllamaTerminal,
	StudyOllamaTransportOptions,
} from './types.js'
import {
	attempt,
	canonicalStringify,
	isArray,
	isInteger,
	isObject,
	isRecord,
	parseJSON,
} from '@orkestrel/contract'
import { StudyError } from '../../core/errors.js'

/**
 * Validates declared role policies against the pinned inventory before any dispatch.
 * @param roles - The declared wire policy of each model role
 * @param models - The pinned served identities
 * @returns Nothing when every policy names a pinned model and a positive output allowance
 * @throws StudyError - Thrown with code `CONFIG` when a policy names an unpinned model, declares no positive safe-integer `num_predict`, or makes the raw judge wire strict
 */
export function validateStudyOllamaRoles(
	roles: StudyOllamaTransportOptions['roles'],
	models: StudyOllamaTransportOptions['models'],
): void {
	const names = Object.values(models).map((model) => model.name)
	for (const [role, policy] of Object.entries(roles)) {
		if (policy === undefined) continue
		if (!names.includes(policy.model))
			throw new StudyError('CONFIG', 'Ollama role policy names a model the inventory does not pin')
		const output = policy.options.num_predict
		if (output === undefined || !Number.isSafeInteger(output) || output <= 0)
			throw new StudyError(
				'CONFIG',
				'Ollama role policy declares no positive num_predict allowance',
			)
		if (role === 'judge' && policy.strict)
			throw new StudyError('CONFIG', 'Ollama strict fields apply only to chat roles')
	}
}

/**
 * Reads exact outbound Ollama facts and refuses a request outside its declared policy.
 * @remarks
 * The refusal happens before admission, so a refused request is never accounted.
 * @param options - The admitted origin, pinned inventory, and declared role policies
 * @param role - The responsible request role
 * @param input - The requested URL
 * @param init - The native fetch settings
 * @returns The validated dispatch facts
 * @throws StudyError - Thrown with code `CONFIG` when the endpoint, model, options, flags, or strict fields differ from the declaration, or the role declares no policy
 */
export function readStudyOllamaRequest(
	options: Pick<StudyOllamaTransportOptions, 'url' | 'models' | 'roles'>,
	role: StudyRole,
	input: string | URL | Request,
	init?: RequestInit,
): StudyOllamaRequest {
	if (input instanceof Request)
		throw new StudyError('CONFIG', 'Ollama transport requires explicit URL requests')
	const url = new URL(input)
	const path =
		role === 'metadata'
			? init?.method === 'POST'
				? '/api/show'
				: '/api/tags'
			: role === 'judge'
				? '/api/generate'
				: '/api/chat'
	if (
		url.origin !== new URL(options.url).origin ||
		url.pathname !== path ||
		url.search !== '' ||
		url.hash !== '' ||
		url.username !== '' ||
		url.password !== ''
	)
		throw new StudyError(
			'CONFIG',
			'Ollama transport endpoint differs from the admitted origin and path',
		)
	if (role === 'metadata') {
		if (path === '/api/show') {
			if (typeof init?.body !== 'string')
				throw new StudyError('CONFIG', 'Invalid model metadata request')
			const body: unknown = JSON.parse(init.body)
			if (
				!isRecord(body) ||
				Object.keys(body).length !== 1 ||
				typeof body.model !== 'string' ||
				!Object.values(options.models).some((model) => model.name === body.model)
			)
				throw new StudyError('CONFIG', 'Invalid model metadata identity')
			return {
				role,
				path,
				model: body.model,
				output: 0,
				bytes: new TextEncoder().encode(init.body).byteLength,
				options: {},
				strict: false,
				length: false,
			}
		}
		if (init?.method !== 'GET' || init.body !== undefined)
			throw new StudyError('CONFIG', 'Invalid inventory request')
		return {
			role,
			path,
			model: undefined,
			output: 0,
			bytes: 0,
			options: {},
			strict: false,
			length: false,
		}
	}
	if (init?.method !== 'POST' || typeof init.body !== 'string')
		throw new StudyError('CONFIG', 'Ollama transport requires an encoded JSON POST')
	const policy = role === 'tool' ? undefined : options.roles[role]
	if (policy === undefined)
		throw new StudyError('CONFIG', 'Ollama transport role has no declared wire policy')
	const output = policy.options.num_predict
	if (output === undefined || !Number.isSafeInteger(output) || output <= 0)
		throw new StudyError('CONFIG', 'Ollama role policy declares no positive num_predict allowance')
	const body: unknown = JSON.parse(init.body)
	if (
		!isRecord(body) ||
		body.model !== policy.model ||
		!isRecord(body.options) ||
		canonicalStringify(body.options) !== canonicalStringify(policy.options) ||
		body.stream !== (role !== 'judge')
	)
		throw new StudyError(
			'CONFIG',
			'Ollama transport model or effective options differ from the declared policy',
		)
	if (
		role === 'judge'
			? body.raw !== true || body.logprobs !== true
			: typeof body.think !== 'boolean' || (body.think === true && !policy.think)
	)
		throw new StudyError('CONFIG', 'Ollama transport flags differ from the declared policy')
	// The strict fields govern chat requests only; the judge's raw generate wire is outside them.
	const strict = policy.strict && role !== 'judge'
	if (strict && (body.truncate !== false || body.shift !== false))
		throw new StudyError('CONFIG', 'Ollama transport must disable native truncation and shifting')
	return {
		role,
		path,
		model: policy.model,
		output,
		bytes: new TextEncoder().encode(init.body).byteLength,
		options: { ...policy.options },
		strict,
		length: policy.length,
	}
}

/**
 * Reads the declared model context ceiling without claiming daemon allocation.
 * @param value - The parsed Ollama show response
 * @param context - The requested total context
 * @returns The unambiguous model context ceiling
 * @throws StudyError - Thrown with code `FAULT` when context metadata is missing, or `CAPACITY` when it is ambiguous or below the requested context
 */
export function readStudyOllamaSupport(value: unknown, context: number): number {
	if (
		!isRecord(value) ||
		!isRecord(value.model_info) ||
		typeof value.model_info['general.architecture'] !== 'string'
	)
		throw new StudyError('FAULT', 'Missing model context metadata')
	const architecture = value.model_info['general.architecture']
	const keys = Object.keys(value.model_info).filter((key) => key.endsWith('.context_length'))
	const ceiling = value.model_info[`${architecture}.context_length`]
	if (
		keys.length !== 1 ||
		typeof ceiling !== 'number' ||
		!Number.isSafeInteger(ceiling) ||
		ceiling < context
	)
		throw new StudyError(
			'CAPACITY',
			'Model context metadata does not support the requested context',
		)
	return ceiling
}

/**
 * Reads a native Ollama error member as the attributable failure it names, without usage.
 * @remarks
 * No token usage is read from the member.
 * The failure is `CAPACITY` when the member, a string or an object, names the exact structured
 * type `exceed_context_size_error` with a finite positive integer `n_prompt_tokens` above `n_ctx`,
 * a `code` of 400 if supplied, and a status of 400 if supplied. Every other member, a malformed
 * one included, is `FAULT` with its readable reason.
 * @param value - The parsed HTTP error body or wire row
 * @param role - The responsibility whose request was dispatched; the failure retains it
 * @param status - The HTTP status of the carrying response; undefined for a row of a stream that answered 200
 * @returns Undefined when the value carries no `error` member; otherwise the attributable failure
 */
export function readStudyOllamaFailure(
	value: unknown,
	role: StudyRole,
	status?: number,
): StudyError | undefined {
	if (!isRecord(value) || !('error' in value)) return undefined
	const field = value.error
	// The live daemon sends structured JSON inside a string; decode it once and unwrap one error object.
	const decoded = typeof field === 'string' ? parseJSON(field) : field
	const structured = isRecord(decoded)
		? isRecord(decoded.error)
			? decoded.error
			: decoded
		: undefined
	const native = structured?.message
	const text =
		typeof native === 'string' && native.trim() !== ''
			? native
			: typeof field === 'string'
				? field
				: ''
	const label = structured?.type
	const type = typeof label === 'string' && label !== '' ? label : undefined
	const origin = status === undefined ? 'Ollama error' : `Ollama HTTP ${status} error`
	const prompt = structured?.n_prompt_tokens
	const limit = structured?.n_ctx
	const capacity =
		type === 'exceed_context_size_error' &&
		isInteger(prompt) &&
		prompt > 0 &&
		isInteger(limit) &&
		limit > 0 &&
		prompt > limit &&
		(structured?.code === undefined || structured?.code === 400) &&
		(status === undefined || status === 400)
	const reason =
		text.trim() === '' && type === undefined
			? `Malformed ${origin}`
			: `${origin}${type === undefined ? '' : ` (${type})`}${text.trim() === '' ? '' : `: ${text}`}`
	return new StudyError(capacity ? 'CAPACITY' : 'FAULT', reason, {
		cause: capacity ? 'capacity' : 'infrastructure',
		message: reason,
		role,
	})
}

/**
 * Reads one Ollama response row without inventing absent usage.
 * @param value - The parsed wire row
 * @param request - The admitted dispatch
 * @returns The terminal facts, or undefined for a nonterminal row
 * @throws StudyError - Thrown with the recognized provider failure when the row carries an `error` member, before any other row check; `FAULT` for a malformed row, model, message, finish reason, or usage
 */
export function readStudyOllamaTerminal(
	value: unknown,
	request: StudyOllamaRequest,
): StudyOllamaTerminal | undefined {
	const failure = readStudyOllamaFailure(value, request.role)
	if (failure !== undefined) throw failure
	if (!isRecord(value) || typeof value.done !== 'boolean')
		throw new StudyError('FAULT', 'Malformed Ollama response row')
	if (value.model !== request.model)
		throw new StudyError('FAULT', 'Ollama response model differs from the dispatched model')
	if (request.role !== 'judge') {
		if (
			!isRecord(value.message) ||
			typeof value.message.content !== 'string' ||
			(value.message.thinking !== undefined && typeof value.message.thinking !== 'string')
		)
			throw new StudyError('FAULT', 'Malformed Ollama message')
		if (value.message.tool_calls !== undefined) {
			if (!isArray(value.message.tool_calls))
				throw new StudyError('FAULT', 'Malformed Ollama tool calls')
			for (const call of value.message.tool_calls)
				if (
					!isRecord(call) ||
					!isRecord(call.function) ||
					typeof call.function.name !== 'string' ||
					!isRecord(call.function.arguments)
				)
					throw new StudyError('FAULT', 'Malformed Ollama tool call')
		}
	}
	if (!value.done) return undefined
	if (typeof value.done_reason !== 'string' || value.done_reason.length === 0)
		throw new StudyError('FAULT', 'Missing Ollama finish reason')
	for (const key of ['prompt_eval_count', 'eval_count'])
		if (
			value[key] !== undefined &&
			(typeof value[key] !== 'number' || !Number.isSafeInteger(value[key]) || value[key] < 0)
		)
			throw new StudyError('FAULT', 'Malformed Ollama usage', {
				cause: 'infrastructure',
				message: 'Malformed Ollama usage',
				role: request.role,
			})
	const prompt = typeof value.prompt_eval_count === 'number' ? value.prompt_eval_count : undefined
	const completion = typeof value.eval_count === 'number' ? value.eval_count : undefined
	return { prompt, completion, reason: value.done_reason }
}

/**
 * Checks terminal policy after the actual wire cost has been retained.
 * @param terminal - The valid terminal facts
 * @param room - The reserved context and safety margin
 * @param request - The admitted dispatch and its declared finish policy; every refusal retains its role
 * @returns Nothing when the completion satisfies the declared policy
 * @throws StudyError - Thrown with code `CAPACITY` when the actual prompt exceeds its room, generation exceeds its allowance, or an undeclared `length` finish or capped generation occurs; `FAULT` for another unsupported finish reason
 */
export function validateStudyOllamaCompletion(
	terminal: StudyOllamaTerminal,
	room: Pick<StudyRoom, 'context' | 'safety'>,
	request: StudyOllamaRequest,
): void {
	const { prompt, completion, reason } = terminal
	const { role } = request
	if (prompt !== undefined && prompt > room.context - request.output - room.safety) {
		const message = 'Actual prompt exceeded reserved context capacity'
		throw new StudyError('CAPACITY', message, { cause: 'capacity', message, role })
	}
	if (completion !== undefined && completion > request.output) {
		const message = 'Actual generation exceeded the output allowance'
		throw new StudyError('CAPACITY', message, { cause: 'capacity', message, role })
	}
	if (
		!request.length &&
		(reason === 'length' || (completion !== undefined && completion >= request.output))
	) {
		const message = 'Substantive generation reached its output cap'
		throw new StudyError('CAPACITY', message, { cause: 'capacity', message, role })
	}
	if (reason !== 'stop' && !(request.length && reason === 'length')) {
		const message = 'Unsupported Ollama finish reason'
		throw new StudyError('FAULT', message, { cause: 'infrastructure', message, role })
	}
}

/**
 * Verifies that each pinned name resolves to one inventory entry with its pinned digest.
 * @param value - The parsed inventory response
 * @param models - The pinned served identities
 * @returns Nothing for a matching inventory
 * @throws StudyError - Thrown with code `FAULT` when the inventory is unsupported or a pinned identity does not match
 */
export function validateStudyOllamaInventory(
	value: unknown,
	models: StudyOllamaTransportOptions['models'],
): void {
	if (!isObject(value) || !('models' in value) || !isArray(value.models))
		throw new StudyError('FAULT', 'Unsupported Ollama inventory')
	const served = value.models
	for (const { name, digest } of Object.values(models)) {
		const matches = served.filter((model) => isRecord(model) && model.name === name)
		const model = matches[0]
		if (
			matches.length !== 1 ||
			!isRecord(model) ||
			typeof model.digest !== 'string' ||
			model.digest.replace(/^sha256:/, '') !== digest.replace(/^sha256:/, '')
		)
			throw new StudyError('FAULT', 'Serving inventory does not match the required model digest')
	}
}

/**
 * Reads the pinned serving digest of an admitted request's model.
 * @param models - The pinned served identities
 * @param request - The admitted dispatch
 * @returns The pinned digest, or undefined for an inventory request or an unpinned model
 */
export function readStudyOllamaDigest(
	models: StudyOllamaTransportOptions['models'],
	request: StudyOllamaRequest,
): string | undefined {
	if (request.model === undefined) return undefined
	return Object.values(models).find((model) => model.name === request.model)?.digest
}

/**
 * Reads daemon timing from a terminal row without letting an observation fail the request.
 * @param extract - The admitted extractor
 * @param record - The validated terminal row
 * @returns The raw timing, or undefined when absent or the extractor throws
 */
export function readStudyOllamaTiming(
	extract: StudyOllamaTransportOptions['timing'],
	record: Readonly<Record<string, unknown>>,
): OllamaTiming | undefined {
	try {
		return extract(record)
	} catch {
		return undefined
	}
}

/**
 * Builds the JSON evidence form of a timing observation with raw nanoseconds and counts.
 * @param timing - The extracted timing
 * @returns Null when no terminal timing was observed; otherwise every unreported member as null
 */
export function buildStudyOllamaTiming(timing: OllamaTiming | undefined): JSONValue {
	if (timing === undefined) return null
	return {
		durations: {
			total: timing.durations.total ?? null,
			load: timing.durations.load ?? null,
			prompt: timing.durations.prompt ?? null,
			decode: timing.durations.decode ?? null,
		},
		counts: {
			prompt: timing.counts.prompt ?? null,
			decode: timing.counts.decode ?? null,
			cached: timing.counts.cached ?? null,
		},
		invalid: [...timing.invalid],
	}
}

/**
 * Builds a reading of the raw prompt text an encoded request body carries, as sent.
 * @param body - The encoded request body
 * @returns The prompt's UTF-16 code units and UTF-8 bytes, labeled with its encoding, or undefined when there is no string prompt; these are readings of the actual text, not token allocations
 */
export function buildStudyOllamaRaw(body: unknown): JSONValue | undefined {
	if (typeof body !== 'string') return undefined
	const parsed = attempt((): unknown => JSON.parse(body))
	if (!parsed.success || !isRecord(parsed.value) || typeof parsed.value.prompt !== 'string')
		return undefined
	return {
		encoding: 'utf-8',
		units: parsed.value.prompt.length,
		bytes: new TextEncoder().encode(parsed.value.prompt).byteLength,
	}
}
