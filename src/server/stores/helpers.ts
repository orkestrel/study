import type {
	StudyAttempt,
	StudyJudgment,
	StudyLabels,
	StudyManifest,
	StudyRubric,
} from '../../core/types.js'
import type {
	StudyFile,
	StudyPacketBundle,
	StudyPacketEntry,
	StudyPacketLink,
	StudyResultReading,
	StudySealedResult,
} from './types.js'
import { canonicalStringify, parseJSON } from '@orkestrel/contract'
import { constants } from 'node:fs'
import { lstat, open, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join, parse, relative, resolve, sep } from 'node:path'
import { StudyError } from '../../core/errors.js'
import { STUDY_CUSTODY_BYTES, STUDY_PACKET_DISCLOSURE } from './constants.js'
import {
	isStudyCustodyAttempt,
	isStudyCustodyEvidence,
	isStudyCustodyManifest,
	isStudyCustodySeal,
} from './validators.js'

/**
 * Encodes deterministic JSON bytes without synthesizing execution metadata.
 * @param value - The validated record
 * @returns The exact canonical UTF-8 bytes
 * @throws StudyError - Thrown when the record cannot be serialized
 * @example
 * ```ts
 * encodeStudyJSON({ version: 1 })
 * ```
 */
export function encodeStudyJSON(value: unknown): Uint8Array {
	const wire = JSON.stringify(value)
	const text = wire === undefined ? undefined : canonicalStringify(parseJSON(wire))
	if (text === undefined) throw new StudyError('EVIDENCE', 'Record cannot be encoded')
	return Buffer.from(`${text}\n`, 'utf8')
}

/**
 * Computes the lowercase SHA-256 identity of exact bytes.
 * @param bytes - The retained bytes
 * @returns The byte digest
 * @example
 * ```ts
 * hashStudyBytes(new Uint8Array())
 * ```
 */
export function hashStudyBytes(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex')
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
	const links: StudyPacketLink[] = []
	let bytes = 256
	for (const trial of result.manifest.schedule) {
		for (const criterion of rubric.criteria) {
			if (criterion.method !== 'semantic' || criterion.scenario !== trial.scenario) continue
			const link = {
				trial: `t-${hashStudyBytes(encodeStudyJSON([result.seal.id, 'trial', trial.id]))}`,
				criterion: `c-${hashStudyBytes(encodeStudyJSON([result.seal.id, 'criterion', criterion.id]))}`,
				source: { trial: trial.id, criterion: criterion.id },
			}
			bytes += encodeStudyJSON(link).byteLength
			if (bytes > STUDY_CUSTODY_BYTES)
				throw new StudyError('CAPACITY', 'Semantic packet mapping exceeds its custody allowance')
			links.push(link)
		}
	}
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
	let length = encodeStudyJSON({
		version: 1,
		disclosure: STUDY_PACKET_DISCLOSURE,
		entries: [],
	}).byteLength
	const entries: StudyPacketEntry[] = links.map((link) => {
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
		length += encodeStudyJSON(entry).byteLength
		if (length > STUDY_CUSTODY_BYTES)
			throw new StudyError('CAPACITY', 'Semantic packet content exceeds its custody allowance')
		return entry
	})
	return Object.freeze({
		content: encodeStudyJSON({ version: 1, disclosure: STUDY_PACKET_DISCLOSURE, entries }),
		mapping: encodeStudyJSON({
			version: 1,
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
 * translateStudyPacketLabels(result, rubric, rubricDigest, labels)
 * ```
 */
export function translateStudyPacketLabels(
	result: StudySealedResult,
	rubric: StudyRubric,
	digest: string,
	labels: StudyLabels,
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
	let cursor = parse(absolute).root
	for (const name of relative(cursor, absolute).split(sep).filter(Boolean)) {
		cursor = join(cursor, name)
		const stat = await lstat(cursor)
		if (!stat.isDirectory() || stat.isSymbolicLink())
			throw new StudyError('CUSTODY', 'Linked or invalid custody directory')
	}
	return absolute
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
		const bytes = Buffer.alloc(stat.size + 1)
		let length = 0
		while (length < bytes.length) {
			const reading = await handle.read(bytes, length, bytes.length - length, length)
			if (reading.bytesRead === 0) break
			length += reading.bytesRead
		}
		if (length !== stat.size) throw new StudyError('CUSTODY', 'Custody file changed while reading')
		return bytes.subarray(0, length)
	} finally {
		await handle.close()
	}
}

/**
 * Writes an exclusive regular record and synchronizes it before reporting success.
 * @param path - The new custody path
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
	const files: StudyFile[] = []
	const pending = ['']
	const known = new Set(manifest.schedule.map((trial) => trial.id))
	let total = 0
	while (pending.length > 0) {
		const prefix = pending.pop()
		if (prefix === undefined) break
		for (const entry of await readdir(join(directory, ...prefix.split('/').filter(Boolean)), {
			withFileTypes: true,
		})) {
			const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`
			if (entry.isSymbolicLink())
				throw new StudyError('CUSTODY', 'Execution contains a symbolic link')
			if (entry.isDirectory()) {
				if (path !== 'trials' && !(prefix === 'trials' && known.has(entry.name)))
					throw new StudyError('CUSTODY', 'Execution contains an unknown directory')
				pending.push(path)
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
						(names[2] === 'attempt.json' || names[2] === 'evidence.jsonl'))
				)
			)
				throw new StudyError('CUSTODY', 'Execution contains an unknown file')
			const bytes = await readStudyBytes(
				join(directory, ...names),
				manifest.bounds.series.bytes - total,
			)
			total += bytes.byteLength
			files.push(Object.freeze({ path, bytes: bytes.byteLength, digest: hashStudyBytes(bytes) }))
		}
	}
	return Object.freeze(
		files.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0)),
	)
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
	const goals = new Map<string, number>()
	for (const line of text.split(/\r\n|\n/).slice(0, -1)) {
		const evidence = parseJSON(line)
		if (
			!isStudyCustodyEvidence(evidence) ||
			!scenario.goals.some((goal) => goal.id === evidence.goal)
		)
			throw new StudyError('CUSTODY', 'Evidence refers to an invalid goal')
		const length = Buffer.byteLength(`${line}\n`, 'utf8')
		const used = (goals.get(evidence.goal) ?? 0) + length
		if (used > manifest.bounds.goal.bytes)
			throw new StudyError('CUSTODY', 'Evidence exceeds a goal allowance')
		goals.set(evidence.goal, used)
	}
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
	return hashStudyBytes(encodeStudyJSON({ version: 1, result, files }))
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
	let manifest: unknown
	try {
		manifest = parseJSON(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes))
	} catch (error) {
		if (sealed) throw error
	}
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
		let attempt: unknown
		try {
			attempt = parseJSON(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
		} catch (error) {
			if (sealed) throw error
		}
		if (!isStudyCustodyAttempt(attempt, manifest) || attempt.trial.id !== trial.id) {
			if (sealed) throw new StudyError('CUSTODY', 'Invalid or foreign terminal attempt')
			continue
		}
		attempts.push(attempt)
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
	const seal = parseJSON(new TextDecoder('utf-8', { fatal: true }).decode(sealBytes))
	if (
		!isStudyCustodySeal(seal) ||
		seal.result !== manifest.id ||
		seal.id !== computeStudySealId(manifest.id, files) ||
		canonicalStringify(seal.files) !== canonicalStringify(files) ||
		attempts.length !== manifest.schedule.length ||
		files.length !== 1 + manifest.schedule.length * 2
	)
		throw new StudyError('CUSTODY', 'Execution seal does not match the complete byte inventory')
	return Object.freeze({
		status: 'sealed',
		directory: absolute,
		manifest,
		attempts: Object.freeze(attempts),
		seal,
	})
}
