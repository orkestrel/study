import type {
	StudyAttempt,
	StudyEvidence,
	StudyJudgment,
	StudyLabeling,
	StudyManifest,
	StudyRubric,
} from '@src/core'
import type {
	StudyFile,
	StudyExchangeAttempt,
	StudyExchangeDivergence,
	StudyExchangeDeclaration,
	StudyExchangeHistory,
	StudyExchangeIdentity,
	StudyExchangeRow,
	StudyRecordedExchange,
	StudyPacketBundle,
	StudyPacketEntry,
	StudyPacketLink,
	StudyResultReading,
	StudySealedResult,
} from './types.js'
import type { FileHandle } from 'node:fs/promises'
import { StudyError } from '@src/core'
import { attempt, canonicalStringify, isRecord, parseJSON } from '@orkestrel/contract'
import { constants } from 'node:fs'
import { lstat, open, readdir } from 'node:fs/promises'
import { dirname, join, parse, relative, resolve, sep } from 'node:path'
import { decodeStudyJSON, encodeStudyJSON, hashStudyBytes } from '../helpers.js'
import { STUDY_CUSTODY_BYTES, STUDY_PACKET_DISCLOSURE } from './constants.js'
import {
	isStudyCustodyAttempt,
	isStudyCustodyEvidence,
	isStudyCustodyManifest,
	isStudyCustodySeal,
	isStudyExchangeHistory,
	isStudyExchangeRow,
} from './validators.js'

/** Locates the first differing byte, including a length difference after a shared prefix.
 * @param expected - The recorded bytes.
 * @param actual - The executing bytes.
 * @returns The zero-based byte offset, or undefined when the bodies are equal.
 */
export function computeStudyExchangeOffset(
	expected: Uint8Array,
	actual: Uint8Array,
): number | undefined {
	const offset = expected.findIndex((byte, index) => byte !== actual[index])
	return offset >= 0 ? offset : expected.length !== actual.length ? expected.length : undefined
}

/** Finds the first changed or unmatched non-maintenance request by position.
 * @param history - The history already read by the strict sealed reader.
 * @param rows - Replay rows already read by the strict row reader.
 * @returns The first divergence, or undefined after equal complete requests.
 */
export function scanStudyDivergence(
	history: StudyExchangeHistory,
	rows: readonly StudyExchangeRow[],
): StudyExchangeDivergence | undefined {
	const expected = history.exchanges
		.map((pair) => pair.attempt)
		.filter((row) => row.stage !== 'maintenance')
	const actual = rows.filter(
		(row): row is StudyExchangeAttempt => row.phase === 'attempt' && row.stage !== 'maintenance',
	)
	const index = Array.from(
		{ length: Math.max(expected.length, actual.length) },
		(_entry, position) => position,
	).find((position) => {
		const left = expected[position]
		const right = actual[position]
		return (
			left === undefined ||
			right === undefined ||
			left.path !== right.path ||
			left.method !== right.method ||
			left.role !== right.role ||
			left.body !== right.body
		)
	})
	if (index === undefined) return undefined
	const left = expected[index]
	const right = actual[index]
	return {
		ordinal: left?.ordinal ?? history.completion.count + 1,
		expected: left,
		actual: right,
		offset:
			left === undefined || right === undefined
				? undefined
				: computeStudyExchangeOffset(
						Buffer.from(left.body, 'base64'),
						Buffer.from(right.body, 'base64'),
					),
	}
}

/**
 * Builds neutral semantic identities for the complete eligible sealed horizon.
 * @param result - The verified sealed execution
 * @param rubric - The compatible independently held rubric
 * @returns Deterministically sorted neutral mappings
 * @example
 * ```ts
 * buildStudyPacketLinks(result, rubric)
 * ```
 */
export function buildStudyPacketLinks(
	result: StudySealedResult,
	rubric: StudyRubric,
): readonly StudyPacketLink[] {
	// The pairs are produced one at a time, and a hole is a position that reads as absent, so a hole
	// refuses after the links before it were counted, as visiting each position in turn does.
	const pairs = result.manifest.schedule.values().flatMap((trial) =>
		rubric.criteria
			.values()
			.filter(
				(criterion) => criterion.method === 'semantic' && criterion.scenario === trial.scenario,
			)
			.map((criterion) => ({ trial, criterion })),
	)
	// Each record carries the encoded bytes of every link up to and including its own.
	const records: Array<{ readonly link: StudyPacketLink; readonly bytes: number }> = []
	for (const { trial, criterion } of pairs) {
		const link = {
			trial: `t-${hashStudyBytes(encodeStudyJSON([result.seal.id, 'trial', trial.id]))}`,
			criterion: `c-${hashStudyBytes(encodeStudyJSON([result.seal.id, 'criterion', criterion.id]))}`,
			source: { trial: trial.id, criterion: criterion.id },
		}
		const bytes = (records.at(-1)?.bytes ?? 256) + encodeStudyJSON(link).byteLength
		if (bytes > STUDY_CUSTODY_BYTES)
			throw new StudyError('CAPACITY', 'Semantic packet mapping exceeds its custody allowance')
		records.push({ link, bytes })
	}
	const links = records.map(({ link }) => link)
	return Object.freeze(
		links.sort((left, right) =>
			`${left.trial}/${left.criterion}` < `${right.trial}/${right.criterion}`
				? -1
				: `${left.trial}/${left.criterion}` > `${right.trial}/${right.criterion}`
					? 1
					: 0,
		),
	)
}

/**
 * Builds deterministic public semantic inputs and a separately retained private map.
 * @param result - The verified sealed execution
 * @param rubric - The compatible semantic criterion declaration
 * @param digest - The exact imported rubric-byte identity
 * @returns The packet bundle, or undefined for a purely mechanical rubric
 * @throws StudyError - Thrown when a semantic pair has no declared input or terminal record
 * @example
 * ```ts
 * buildStudyPacket(result, rubric, rubricDigest)
 * ```
 */
export function buildStudyPacket(
	result: StudySealedResult,
	rubric: StudyRubric,
	digest: string,
): StudyPacketBundle | undefined {
	const links = buildStudyPacketLinks(result, rubric)
	if (links.length === 0) return undefined
	const opening = encodeStudyJSON({ disclosure: STUDY_PACKET_DISCLOSURE, entries: [] }).byteLength
	// Each link is looked up, refused or counted before the next one is read; each record carries the
	// encoded bytes of every entry up to and including its own.
	const records: Array<{ readonly entry: StudyPacketEntry; readonly length: number }> = []
	for (const link of links) {
		const trial = result.manifest.schedule.find((entry) => entry.id === link.source.trial)
		const criterion = rubric.criteria.find((entry) => entry.id === link.source.criterion)
		const scenario = result.manifest.scenarios.find((entry) => entry.id === trial?.scenario)
		const goal = scenario?.goals.find((entry) => entry.id === criterion?.goal)
		const observation = result.attempts
			.find((entry) => entry.trial.id === link.source.trial)
			?.observations.find((entry) => entry.goal === criterion?.goal)
		if (criterion === undefined || goal === undefined || observation === undefined)
			throw new StudyError('EVIDENCE', 'Semantic packet refers to an absent sealed horizon')
		const entry = {
			trial: link.trial,
			criterion: link.criterion,
			input: goal.input,
			product: observation.product,
			assertion: criterion.assertion,
		}
		const length = (records.at(-1)?.length ?? opening) + encodeStudyJSON(entry).byteLength
		if (length > STUDY_CUSTODY_BYTES)
			throw new StudyError('CAPACITY', 'Semantic packet content exceeds its custody allowance')
		records.push({ entry, length })
	}
	const entries = records.map(({ entry }) => entry)
	return Object.freeze({
		content: encodeStudyJSON({ disclosure: STUDY_PACKET_DISCLOSURE, entries }),
		mapping: encodeStudyJSON({
			result: result.seal.id,
			rubric: digest,
			entries: links,
		}),
	})
}

/**
 * Computes a bundle identity binding exact public packet and private map bytes.
 * @param packet - The immutable grading packet bundle
 * @returns The exact bundle digest
 * @example
 * ```ts
 * computeStudyPacketDigest(packet)
 * ```
 */
export function computeStudyPacketDigest(packet: StudyPacketBundle): string {
	return hashStudyBytes(
		encodeStudyJSON({
			content: hashStudyBytes(packet.content),
			mapping: hashStudyBytes(packet.mapping),
		}),
	)
}

/**
 * Translates bound neutral imported labels through the sealed semantic horizon.
 * @param result - The verified sealed execution
 * @param rubric - The retained rubric
 * @param digest - The exact retained rubric-byte identity
 * @param labels - The original imported neutral labels
 * @returns Judgments translated to scheduled trial and criterion identities
 * @throws StudyError - Thrown when the packet or a label identity is foreign
 * @example
 * ```ts
 * translateStudyPacketLabeling(result, rubric, rubricDigest, labels)
 * ```
 */
export function translateStudyPacketLabeling(
	result: StudySealedResult,
	rubric: StudyRubric,
	digest: string,
	labels: StudyLabeling,
): readonly StudyJudgment[] {
	const packet = buildStudyPacket(result, rubric, digest)
	if (packet === undefined || labels.packet !== hashStudyBytes(packet.content))
		throw new StudyError('EVIDENCE', 'Labels bind a different semantic packet')
	const links = buildStudyPacketLinks(result, rubric)
	return Object.freeze(
		labels.judgments.map((judgment) => {
			const link = links.find(
				(entry) => entry.trial === judgment.trial && entry.criterion === judgment.criterion,
			)
			if (link === undefined || (judgment.method !== 'human' && judgment.method !== 'model'))
				throw new StudyError('EVIDENCE', 'Label refers to a foreign semantic packet identity')
			return { ...judgment, trial: link.source.trial, criterion: link.source.criterion }
		}),
	)
}

/**
 * Refuses symbolic links and non-directory ancestors before custody operations.
 * @param directory - The absolute or relative directory
 * @returns The resolved checked directory
 * @throws StudyError - Thrown when any ancestor is linked or is not a directory
 * @example
 * ```ts
 * await checkStudyDirectory(directory)
 * ```
 */
export async function checkStudyDirectory(directory: string): Promise<string> {
	const absolute = resolve(directory)
	const root = parse(absolute).root
	const names = relative(root, absolute).split(sep).filter(Boolean)
	for (const [index] of names.entries()) {
		const stat = await lstat(join(root, ...names.slice(0, index + 1)))
		if (!stat.isDirectory() || stat.isSymbolicLink())
			throw new StudyError('CUSTODY', 'Linked or invalid custody directory')
	}
	return absolute
}

/**
 * Reads from an open file handle into a buffer until the buffer is full or the file ends.
 * @param handle - The open file handle to read
 * @param target - The buffer to fill from the start of the file
 * @param offset - The position in the file and the buffer to continue from; Default: 0
 * @returns The bytes read, as the whole buffer when the file filled it or as its leading part when the file ended first
 */
export async function readStudyHandle(
	handle: FileHandle,
	target: Buffer,
	offset = 0,
): Promise<Buffer> {
	if (offset >= target.length) return target
	const reading = await handle.read(target, offset, target.length - offset, offset)
	return reading.bytesRead === 0
		? target.subarray(0, offset)
		: readStudyHandle(handle, target, offset + reading.bytesRead)
}

/**
 * Reads bounded regular-file bytes without following a symbolic link.
 * @param path - The custody file path
 * @param limit - The byte allowance
 * @returns Exact retained bytes
 * @throws StudyError - Thrown when the file is linked, oversized, changed, or not regular
 * @example
 * ```ts
 * await readStudyBytes(path, 1024)
 * ```
 */
export async function readStudyBytes(path: string, limit: number): Promise<Uint8Array> {
	if (!Number.isSafeInteger(limit) || limit < 0)
		throw new StudyError('CONFIG', 'Invalid custody byte allowance')
	await checkStudyDirectory(dirname(path))
	const prior = await lstat(path)
	if (prior.isSymbolicLink() || !prior.isFile() || prior.size > limit)
		throw new StudyError('CUSTODY', 'Invalid or oversized custody file')
	const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
	try {
		const stat = await handle.stat()
		if (!stat.isFile() || stat.size > limit || stat.dev !== prior.dev || stat.ino !== prior.ino)
			throw new StudyError('CUSTODY', 'Custody file changed during admission')
		const bytes = await readStudyHandle(handle, Buffer.alloc(stat.size + 1))
		if (bytes.length !== stat.size)
			throw new StudyError('CUSTODY', 'Custody file changed while reading')
		return bytes
	} finally {
		await handle.close()
	}
}

/**
 * Writes an exclusive regular record and synchronizes it before reporting success.
 * @param path - The destination custody path
 * @param bytes - The exact encoded record
 * @returns Nothing after the record is synchronized
 * @example
 * ```ts
 * await writeStudyBytes(path, bytes)
 * ```
 */
export async function writeStudyBytes(path: string, bytes: Uint8Array): Promise<void> {
	await checkStudyDirectory(dirname(path))
	const handle = await open(path, 'wx')
	try {
		await handle.writeFile(bytes)
		await handle.sync()
	} finally {
		await handle.close()
	}
}

/**
 * Scans regular execution files while refusing unknown directories and linked paths.
 * @param directory - The execution directory
 * @param manifest - The authoritative population
 * @returns Sorted exact inventory entries
 * @throws StudyError - Thrown when inventory escapes its declared tree
 * @example
 * ```ts
 * await scanStudyExecution(directory, manifest)
 * ```
 */
export async function scanStudyExecution(
	directory: string,
	manifest: StudyManifest,
): Promise<readonly StudyFile[]> {
	await checkStudyDirectory(directory)
	const known = new Set(manifest.schedule.map((trial) => trial.id))
	const files = await scanStudyTree(
		directory,
		'',
		known,
		manifest.bounds.series.bytes,
		manifest.record !== undefined,
	)
	return Object.freeze(
		[...files].sort((left, right) =>
			left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
		),
	)
}

/**
 * Scans one execution directory and the subdirectories it admits, reading each admitted file under the series bytes that remain.
 * @param directory - The execution directory
 * @param prefix - The slash-separated path of the scanned directory; the empty string names the execution root
 * @param known - The scheduled trial identities
 * @param allowance - The series bytes that remain before this directory
 * @returns The admitted files in read order: this directory's files, then each admitted subdirectory's, last listed first
 * @throws StudyError - Thrown when the tree holds a link, an unknown directory or file, or a file beyond the remaining allowance
 */
export async function scanStudyTree(
	directory: string,
	prefix: string,
	known: ReadonlySet<string>,
	allowance: number,
	recording = false,
): Promise<readonly StudyFile[]> {
	const files: StudyFile[] = []
	const directories: string[] = []
	for (const entry of await readdir(join(directory, ...prefix.split('/').filter(Boolean)), {
		withFileTypes: true,
	})) {
		const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`
		if (entry.isSymbolicLink())
			throw new StudyError('CUSTODY', 'Execution contains a symbolic link')
		if (entry.isDirectory()) {
			if (path !== 'trials' && !(prefix === 'trials' && known.has(entry.name)))
				throw new StudyError('CUSTODY', 'Execution contains an unknown directory')
			directories.push(path)
			continue
		}
		const names = path.split('/')
		if (
			!entry.isFile() ||
			!(
				path === 'manifest.json' ||
				(names.length === 3 &&
					names[0] === 'trials' &&
					known.has(names[1] ?? '') &&
					(names[2] === 'attempt.json' ||
						names[2] === 'evidence.jsonl' ||
						(recording && names[2] === 'exchanges.jsonl')))
			)
		)
			throw new StudyError('CUSTODY', 'Execution contains an unknown file')
		// A directory admits at most two file names, so the sum over its earlier files is constant work.
		const bytes = await readStudyBytes(
			join(directory, ...names),
			files.reduce((left, file) => left - file.bytes, allowance),
		)
		files.push(Object.freeze({ path, bytes: bytes.byteLength, digest: hashStudyBytes(bytes) }))
	}
	const remaining = files.reduce((left, file) => left - file.bytes, allowance)
	// Each step carries the allowance its subtree left, computed once from the step before it.
	const steps: Array<{ readonly found: readonly StudyFile[]; readonly left: number }> = []
	for (const child of [...directories].reverse()) {
		const before = steps.at(-1)?.left ?? remaining
		const found = await scanStudyTree(directory, child, known, before, recording)
		steps.push({ found, left: found.reduce((left, file) => left - file.bytes, before) })
	}
	return [...files, ...steps.flatMap((step) => step.found)]
}

/**
 * Validates complete evidence lines and per-goal encoded evidence bounds.
 * @param bytes - The exact JSONL file
 * @param manifest - The bounds and scenario declarations
 * @param trial - The scheduled trial identity
 * @returns Nothing when evidence satisfies its custody contract
 * @throws StudyError - Thrown when evidence is partial, invalid, foreign, or oversized
 * @example
 * ```ts
 * validateStudyEvidenceBytes(bytes, manifest, trial)
 * ```
 */
export function validateStudyEvidenceBytes(
	bytes: Uint8Array,
	manifest: StudyManifest,
	trial: string,
): void {
	const scheduled = manifest.schedule.find((entry) => entry.id === trial)
	const scenario = manifest.scenarios.find((entry) => entry.id === scheduled?.scenario)
	if (scenario === undefined || bytes.byteLength > manifest.bounds.trial.bytes)
		throw new StudyError('CUSTODY', 'Evidence exceeds the declared trial')
	const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
	if (text !== '' && !text.endsWith('\n'))
		throw new StudyError('CUSTODY', 'Evidence ends with a partial record')
	// A line's goal is undefined where it is not valid evidence for a declared goal.
	const records = text
		.split(/\r\n|\n/)
		.slice(0, -1)
		.map((line) => {
			const evidence = parseJSON(line)
			return {
				goal:
					isStudyCustodyEvidence(evidence) &&
					scenario.goals.some((goal) => goal.id === evidence.goal)
						? evidence.goal
						: undefined,
				size: Buffer.byteLength(`${line}\n`, 'utf8'),
			}
		})
	// Only the lines before the first invalid one count: an overflow among them is the earlier refusal.
	const invalid = records.findIndex(({ goal }) => goal === undefined)
	const admitted = invalid === -1 ? records : records.slice(0, invalid)
	if (
		[...Map.groupBy(admitted, ({ goal }) => goal).values()].some(
			(group) => group.reduce((total, { size }) => total + size, 0) > manifest.bounds.goal.bytes,
		)
	)
		throw new StudyError('CUSTODY', 'Evidence exceeds a goal allowance')
	if (invalid !== -1) throw new StudyError('CUSTODY', 'Evidence refers to an invalid goal')
}

/**
 * Computes an execution seal identity from its exact sorted inventory.
 * @param result - The manifest result identity
 * @param files - The sorted inventory
 * @returns The deterministic seal digest
 * @example
 * ```ts
 * computeStudySealId('execution', files)
 * ```
 */
export function computeStudySealId(result: string, files: readonly StudyFile[]): string {
	return hashStudyBytes(encodeStudyJSON({ result, files }))
}

/**
 * Inspects custody bytes offline and verifies complete execution before grading.
 * @param directory - The result directory
 * @returns A sealed result or explicitly interrupted safe metadata
 * @throws StudyError - Thrown when existing custody bytes are invalid or tampered
 * @example
 * ```ts
 * await readStudyResult(directory)
 * ```
 */
export async function readStudyResult(directory: string): Promise<StudyResultReading> {
	const absolute = await checkStudyDirectory(directory)
	const root = await readdir(absolute, { withFileTypes: true })
	for (const entry of root) {
		if (entry.isSymbolicLink()) throw new StudyError('CUSTODY', 'Result contains a symbolic link')
		if (
			entry.name === 'execution' || entry.name === 'grades' || entry.name === 'reports'
				? !entry.isDirectory()
				: entry.name !== 'seal.json' || !entry.isFile()
		)
			throw new StudyError('CUSTODY', 'Result contains an unknown path')
	}
	const sealed = root.some((entry) => entry.name === 'seal.json')
	if (!root.some((entry) => entry.name === 'execution')) {
		if (sealed) throw new StudyError('CUSTODY', 'Sealed result is missing execution')
		return Object.freeze({
			status: 'interrupted',
			directory: absolute,
			manifest: undefined,
			attempts: Object.freeze([]),
		})
	}
	const execution = join(absolute, 'execution')
	const entries = await readdir(execution, { withFileTypes: true })
	if (!entries.some((entry) => entry.name === 'manifest.json')) {
		if (entries.length !== 0 || sealed)
			throw new StudyError('CUSTODY', 'Execution is missing its manifest')
		return Object.freeze({
			status: 'interrupted',
			directory: absolute,
			manifest: undefined,
			attempts: Object.freeze([]),
		})
	}
	const manifestBytes = await readStudyBytes(join(execution, 'manifest.json'), STUDY_CUSTODY_BYTES)
	const decoded = attempt((): unknown => decodeStudyJSON(manifestBytes))
	if (!decoded.success && sealed) throw decoded.error
	const manifest: unknown = decoded.success ? decoded.value : undefined
	if (!isStudyCustodyManifest(manifest)) {
		if (sealed) throw new StudyError('CUSTODY', 'Invalid execution manifest')
		return Object.freeze({
			status: 'interrupted',
			directory: absolute,
			manifest: undefined,
			attempts: Object.freeze([]),
		})
	}
	const files = await scanStudyExecution(execution, manifest)
	if (
		files.find((entry) => entry.path === 'manifest.json')?.digest !== hashStudyBytes(manifestBytes)
	)
		throw new StudyError('CUSTODY', 'Manifest changed during inventory reading')
	const attempts: StudyAttempt[] = []
	for (const trial of manifest.schedule) {
		const evidence = files.find((entry) => entry.path === `trials/${trial.id}/evidence.jsonl`)
		if (evidence !== undefined && sealed) {
			const bytes = await readStudyBytes(
				join(execution, 'trials', trial.id, 'evidence.jsonl'),
				manifest.bounds.trial.bytes,
			)
			if (hashStudyBytes(bytes) !== evidence.digest)
				throw new StudyError('CUSTODY', 'Evidence changed during inventory reading')
			validateStudyEvidenceBytes(bytes, manifest, trial.id)
		}
		const terminal = files.find((entry) => entry.path === `trials/${trial.id}/attempt.json`)
		if (terminal === undefined) continue
		if (evidence === undefined)
			throw new StudyError('CUSTODY', 'Terminal attempt is missing its evidence file')
		const bytes = await readStudyBytes(
			join(execution, 'trials', trial.id, 'attempt.json'),
			STUDY_CUSTODY_BYTES,
		)
		if (hashStudyBytes(bytes) !== terminal.digest)
			throw new StudyError('CUSTODY', 'Attempt changed during inventory reading')
		const reading = attempt((): unknown => decodeStudyJSON(bytes))
		if (!reading.success && sealed) throw reading.error
		const record: unknown = reading.success ? reading.value : undefined
		if (!isStudyCustodyAttempt(record, manifest) || record.trial.id !== trial.id) {
			if (sealed) throw new StudyError('CUSTODY', 'Invalid or foreign terminal attempt')
			continue
		}
		attempts.push(record)
	}
	if (!sealed)
		return Object.freeze({
			status: 'interrupted',
			directory: absolute,
			manifest,
			attempts: Object.freeze(attempts),
		})
	const sealBytes = await readStudyBytes(join(absolute, 'seal.json'), STUDY_CUSTODY_BYTES)
	if (
		files.reduce((total, file) => total + file.bytes, sealBytes.byteLength) >
		manifest.bounds.series.bytes
	)
		throw new StudyError('CUSTODY', 'Seal and execution exceed the series allowance')
	const seal = decodeStudyJSON(sealBytes)
	if (
		!isStudyCustodySeal(seal) ||
		seal.result !== manifest.id ||
		seal.id !== computeStudySealId(manifest.id, files) ||
		canonicalStringify(seal.files) !== canonicalStringify(files) ||
		attempts.length !== manifest.schedule.length ||
		files.length !== 1 + manifest.schedule.length * (manifest.record === undefined ? 2 : 3)
	)
		throw new StudyError('CUSTODY', 'Execution seal does not match the complete byte inventory')
	if (manifest.record !== undefined) {
		for (const trial of manifest.schedule) {
			const file = files.find((entry) => entry.path === `trials/${trial.id}/exchanges.jsonl`)
			if (file === undefined)
				throw new StudyError('CUSTODY', 'Recorded trial is missing its exchange sidecar')
			await readStudyTrialExchanges(absolute, manifest, trial.id, file)
		}
	}
	return Object.freeze({
		status: 'sealed',
		directory: absolute,
		manifest,
		attempts: Object.freeze(attempts),
		seal,
	})
}

/** Projects fixed and declared HTTP identities around the retained execution population.
 * @param declaration - The validated opening row.
 * @param execution - The retained execution attempt count, including the current attempt.
 * @returns Maintenance, preflight, optional declared model steps and offset postflight identities.
 */
export function buildStudyExchangeSequence(
	declaration: StudyExchangeDeclaration,
	execution: number,
): readonly StudyExchangeIdentity[] {
	if (!Number.isSafeInteger(execution) || execution < 0)
		throw new StudyError('CUSTODY', 'Invalid execution exchange count')
	const first = declaration.goals[0]
	const last = declaration.goals.at(-1)
	if (first === undefined || last === undefined)
		throw new StudyError('CUSTODY', 'Exchange procedure is empty')
	const models = Object.values(declaration.models).filter(
		(model, index, entries) => entries.findIndex((entry) => entry.name === model.name) === index,
	)
	const maintenance: readonly StudyExchangeIdentity[] = declaration.maintenance.map(
		(_model, index) => ({
			ordinal: index + 1,
			goal: first,
			role: 'maintenance',
			path: '/api/generate',
			method: 'POST',
			stage: 'maintenance',
		}),
	)
	const preflight: readonly StudyExchangeIdentity[] = [
		'/api/version',
		'/api/tags',
		...models.map(() => '/api/show'),
	].map((path, index) => ({
		ordinal: maintenance.length + index + 1,
		goal: first,
		role: 'metadata',
		path:
			path === '/api/version' ? '/api/version' : path === '/api/tags' ? '/api/tags' : '/api/show',
		method: path === '/api/show' ? 'POST' : 'GET',
		stage: 'preflight',
	}))
	const steps: readonly StudyExchangeIdentity[] = (declaration.procedure ?? []).map(
		(step, index) => ({
			ordinal: maintenance.length + preflight.length + index + 1,
			goal: step.goal,
			role: step.role,
			path: step.path,
			method: 'POST',
			stage: 'execution',
			step: step.ordinal,
		}),
	)
	const postflight: readonly StudyExchangeIdentity[] = preflight.map((identity, index) => ({
		...identity,
		ordinal: maintenance.length + preflight.length + execution + index + 1,
		goal: last,
		stage: 'postflight',
	}))
	return [...maintenance, ...preflight, ...steps, ...postflight]
}

/** Projects only the repeated identity fields of a retained HTTP exchange.
 * @param identity - The row whose body and lifecycle fields are omitted.
 * @returns The identity repeated by its attempt and terminal.
 */
export function projectStudyExchangeIdentity(
	identity: StudyExchangeIdentity,
): StudyExchangeIdentity {
	return {
		ordinal: identity.ordinal,
		goal: identity.goal,
		role: identity.role,
		path: identity.path,
		method: identity.method,
		stage: identity.stage,
		...(identity.step === undefined ? {} : { step: identity.step }),
	}
}

/** Validates the exact declaration order and request bytes of an admitted exchange.
 * @param declaration - The validated opening horizon and optional procedure.
 * @param request - The admitted request to join.
 * @param execution - The retained execution attempt count.
 * @returns Nothing after identity, exact-body or capture-length validation.
 */
export function validateStudyExchangeRequest(
	declaration: StudyExchangeDeclaration,
	request: StudyExchangeAttempt,
	execution: number,
): void {
	if (request.stage === 'execution' && declaration.procedure === undefined) return
	const expected = buildStudyExchangeSequence(declaration, execution).find(
		(identity) => identity.ordinal === request.ordinal && identity.stage === request.stage,
	)
	if (
		expected === undefined ||
		canonicalStringify(expected) !== canonicalStringify(projectStudyExchangeIdentity(request))
	)
		throw new StudyError('CUSTODY', 'Exchange differs from its declared order')
	const bytes = Buffer.from(request.body, 'base64')
	if (request.stage === 'execution') {
		const step = declaration.procedure?.find((entry) => entry.ordinal === request.step)
		if (
			step === undefined ||
			(step.admission === 'exact'
				? !bytes.equals(Buffer.from(step.body)) || request.digest !== step.input
				: bytes.length !== step.bytes)
		)
			throw new StudyError('CUSTODY', 'Exchange request differs from its declared admission')
		return
	}
	if (request.stage === 'maintenance') {
		const model = declaration.maintenance[request.ordinal - 1]
		const body = parseJSON(bytes.toString('utf8'))
		if (
			model === undefined ||
			!isRecord(body) ||
			body.model !== model.name ||
			body.keep_alive !== 0
		)
			throw new StudyError('CUSTODY', 'Maintenance request differs from its declaration')
		return
	}
	const models = Object.values(declaration.models).filter(
		(model, index, entries) => entries.findIndex((entry) => entry.name === model.name) === index,
	)
	const population = models.length + 2
	const offset =
		request.ordinal -
		declaration.maintenance.length -
		(request.stage === 'postflight' ? population + execution : 0) -
		1
	const model = models[offset - 2]
	const body =
		request.path === '/api/show' && model !== undefined ? JSON.stringify({ model: model.name }) : ''
	if (!bytes.equals(Buffer.from(body)))
		throw new StudyError('CUSTODY', 'Metadata request differs from its declaration')
}

/** Validates a serialized journal prefix or its complete successful population.
 * @param rows - The owned rows in physical append order.
 * @param complete - If true, requires successful completion; if false, admits an unfinished prefix.
 * @returns Nothing when every row joins its preceding attempt and declared sequence.
 */
export function validateStudyExchangeRows(
	rows: readonly StudyExchangeRow[],
	complete = true,
): void {
	const declaration = rows[0]
	if (declaration?.phase !== 'declaration' || !rows.every(isStudyExchangeRow))
		throw new StudyError('CUSTODY', 'Exchange declaration or row is invalid')
	const attempts = rows.filter((row) => row.phase === 'attempt')
	const execution = attempts.filter((row) => row.stage === 'execution')
	const population = buildStudyExchangeSequence(declaration, execution.length)
	const prefix = population.filter(
		(row) => row.stage === 'maintenance' || row.stage === 'preflight',
	).length
	for (const [index, row] of rows.entries()) {
		if (index === 0) continue
		const previous = rows[index - 1]
		if (row.phase === 'attempt') {
			if (previous?.phase !== 'declaration' && previous?.phase !== 'response')
				throw new StudyError('CUSTODY', 'Exchange attempt overlaps an unfinished attempt')
			if (
				row.ordinal !==
				rows.slice(0, index).filter((entry) => entry.phase === 'attempt').length + 1
			)
				throw new StudyError('CUSTODY', 'Exchange ordinals are not contiguous')
			if (row.stage === 'execution') {
				const step = execution.findIndex((entry) => entry === row)
				const goal = declaration.goals.indexOf(row.goal)
				const prior = execution[step - 1]
				if (
					row.step !== step + 1 ||
					row.ordinal !== prefix + step + 1 ||
					step >= declaration.record.calls ||
					goal < 0 ||
					(prior !== undefined && goal < declaration.goals.indexOf(prior.goal)) ||
					attempts.some((entry) => entry.ordinal < row.ordinal && entry.stage === 'postflight')
				)
					throw new StudyError(
						'CUSTODY',
						'Execution differs from its horizon, calls or stage order',
					)
			}
			validateStudyExchangeRequest(declaration, row, execution.length)
		} else if (row.phase === 'response' || row.phase === 'failure') {
			if (
				previous?.phase !== 'attempt' ||
				canonicalStringify(projectStudyExchangeIdentity(previous)) !==
					canonicalStringify(projectStudyExchangeIdentity(row))
			)
				throw new StudyError('CUSTODY', 'Exchange terminal has no matching attempt')
		} else if (row.phase === 'complete') {
			if (
				index !== rows.length - 1 ||
				previous?.phase !== 'response' ||
				row.count !== attempts.length ||
				row.count !==
					prefix +
						execution.length +
						population.filter((entry) => entry.stage === 'postflight').length ||
				(declaration.procedure !== undefined &&
					execution.length !== declaration.procedure.length) ||
				rows.some((entry) => entry.phase === 'failure')
			)
				throw new StudyError('CUSTODY', 'Exchange completion is partial or failed')
		} else throw new StudyError('CUSTODY', 'Exchange declaration repeats')
	}
	if (complete && rows.at(-1)?.phase !== 'complete')
		throw new StudyError('CUSTODY', 'Exchange history has no successful completion')
}

/** Reads strict complete LF-framed exchange rows with verified bodies and declaration joins.
 * @param bytes - The bounded retained sidecar bytes.
 * @param complete - If true, requires completion; if false, admits a verified unfinished prefix.
 * @returns Owned rows in physical order.
 */
export function readStudyExchangeRows(
	bytes: Uint8Array,
	complete = true,
): readonly StudyExchangeRow[] {
	try {
		const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
		if (!text.endsWith('\n'))
			throw new StudyError('CUSTODY', 'Exchange sidecar ends with a partial record')
		const rows = text
			.split(/\r\n|\n/)
			.slice(0, -1)
			.map((line) => {
				const row = parseJSON(line)
				if (!isStudyExchangeRow(row))
					throw new StudyError('CUSTODY', 'Exchange sidecar contains an invalid row')
				return row
			})
		validateStudyExchangeRows(rows, complete)
		return rows
	} catch (error) {
		throw new StudyError(
			'CUSTODY',
			error instanceof Error ? error.message : 'Invalid exchange bytes',
		)
	}
}

/** Validates complete history envelopes again before a replay may perform dependent work.
 * @param history - The strict-reader result, treated as untrusted at this boundary.
 * @returns Nothing after complete row, file and declaration verification.
 */
export function validateStudyExchangeHistory(history: StudyExchangeHistory): void {
	if (
		!isStudyExchangeHistory(history) ||
		history.file.path !== `trials/${history.declaration.trial}/exchanges.jsonl`
	)
		throw new StudyError('CUSTODY', 'Replay requires a verified sealed exchange history')
	const rows = [
		history.declaration,
		...history.exchanges.flatMap((pair) => [pair.attempt, pair.response]),
		history.completion,
	]
	validateStudyExchangeRows(rows)
	const bytes = Buffer.from(rows.map((row) => JSON.stringify(row) + '\n').join(''))
	if (
		bytes.length > history.declaration.record.bytes ||
		history.file.bytes !== bytes.length ||
		history.file.digest !== hashStudyBytes(bytes)
	)
		throw new StudyError('CUSTODY', 'Replay history differs from its retained file identity')
}

/** Joins recorded exchanges to exactly one dispatch and wire evidence identity per ordinal.
 * @param rows - The complete successful sidecar rows.
 * @param evidence - The validated trial evidence rows.
 * @returns Nothing when all retained exchange identities have exact evidence counterparts.
 */
export function validateStudyExchangeEvidence(
	rows: readonly StudyExchangeRow[],
	evidence: readonly StudyEvidence[],
): void {
	const attempts = rows.filter((row) => row.phase === 'attempt')
	for (const event of ['dispatch', 'wire']) {
		const joined = evidence.filter(
			(row) => row.event === event && isRecord(row.value) && row.value.ordinal !== undefined,
		)
		if (
			joined.length !== attempts.length ||
			!joined.every((row, index) => {
				const request = attempts[index]
				return (
					request !== undefined &&
					isRecord(row.value) &&
					row.value.ordinal === request.ordinal &&
					row.goal === request.goal &&
					row.value.role === request.role &&
					row.value.path === request.path
				)
			})
		)
			throw new StudyError('CUSTODY', 'Exchange sidecar and evidence ordinals do not join exactly')
	}
}

/** Reads and joins a complete trial sidecar before or after sealing.
 * @param directory - The result directory.
 * @param manifest - The verified manifest declaring recording and bounds.
 * @param trial - The exact scheduled trial id.
 * @param file - The inventory identity read for this sidecar.
 * @returns Complete rows after byte, declaration and evidence joins.
 */
export async function readStudyTrialExchanges(
	directory: string,
	manifest: StudyManifest,
	trial: string,
	file: StudyFile,
): Promise<readonly StudyExchangeRow[]> {
	if (manifest.record === undefined || file.path !== `trials/${trial}/exchanges.jsonl`)
		throw new StudyError('CUSTODY', 'Sidecar has no recording declaration')
	const bytes = await readStudyBytes(
		join(directory, 'execution', 'trials', trial, 'exchanges.jsonl'),
		manifest.record.bytes,
	)
	if (bytes.length !== file.bytes || hashStudyBytes(bytes) !== file.digest)
		throw new StudyError('CUSTODY', 'Exchange sidecar changed during reading')
	const rows = readStudyExchangeRows(bytes)
	const declaration = rows[0]
	const scheduled = manifest.schedule.find((entry) => entry.id === trial)
	const scenario = manifest.scenarios.find((entry) => entry.id === scheduled?.scenario)
	if (
		declaration?.phase !== 'declaration' ||
		declaration.trial !== trial ||
		scenario === undefined ||
		canonicalStringify(declaration.goals) !==
			canonicalStringify(scenario.goals.map((goal) => goal.id)) ||
		canonicalStringify(declaration.record) !== canonicalStringify(manifest.record) ||
		canonicalStringify(
			declaration.ancestor === undefined
				? undefined
				: {
						result: declaration.ancestor.result,
						seal: declaration.ancestor.seal,
						identity: declaration.ancestor.identity,
					},
		) !== canonicalStringify(manifest.ancestor)
	)
		throw new StudyError('CUSTODY', 'Exchange declaration differs from its trial')
	const evidenceBytes = await readStudyBytes(
		join(directory, 'execution', 'trials', trial, 'evidence.jsonl'),
		manifest.bounds.trial.bytes,
	)
	validateStudyEvidenceBytes(evidenceBytes, manifest, trial)
	const evidence = new TextDecoder('utf-8', { fatal: true })
		.decode(evidenceBytes)
		.split(/\r\n|\n/)
		.slice(0, -1)
		.map((line) => {
			const row = parseJSON(line)
			if (!isStudyCustodyEvidence(row)) throw new StudyError('CUSTODY', 'Invalid exchange evidence')
			return row
		})
	validateStudyExchangeEvidence(rows, evidence)
	return rows
}

/** Reads a sealed trial's exact complete exchange history after reverifying its entire result.
 * @param result - The sealed execution selected for replay.
 * @param trial - The scheduled trial id.
 * @returns Complete ordered request and response pairs with their verified file and seal identities.
 */
export async function readStudyExchanges(
	result: StudySealedResult,
	trial: string,
): Promise<StudyExchangeHistory> {
	const reading = await readStudyResult(result.directory)
	if (reading.status !== 'sealed' || reading.seal.id !== result.seal.id)
		throw new StudyError('CUSTODY', 'Replay result is unsealed or changed')
	const file = reading.seal.files.find((entry) => entry.path === `trials/${trial}/exchanges.jsonl`)
	if (file === undefined)
		throw new StudyError('CUSTODY', 'Recorded trial is missing its exchange sidecar')
	const rows = await readStudyTrialExchanges(reading.directory, reading.manifest, trial, file)
	const declaration = rows[0]
	const completion = rows.at(-1)
	if (declaration?.phase !== 'declaration' || completion?.phase !== 'complete')
		throw new StudyError('CUSTODY', 'Exchange boundaries are missing')
	const exchanges: readonly StudyRecordedExchange[] = rows.flatMap((row, index) => {
		const response = rows[index + 1]
		return row.phase === 'attempt' && response?.phase === 'response'
			? [{ attempt: row, response }]
			: []
	})
	const history = { seal: reading.seal.id, file, declaration, exchanges, completion }
	validateStudyExchangeHistory(history)
	return history
}
