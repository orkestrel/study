import type {
	StudyAttempt,
	StudyJudgment,
	StudyLabeling,
	StudyManifest,
	StudyRubric,
} from '@src/core'
import type {
	StudyFile,
	StudyPacketBundle,
	StudyPacketEntry,
	StudyPacketLink,
	StudyResultReading,
	StudySealedResult,
} from './types.js'
import type { FileHandle } from 'node:fs/promises'
import { StudyError } from '@src/core'
import { attempt, canonicalStringify, parseJSON } from '@orkestrel/contract'
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
} from './validators.js'

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
	const known = new Set(manifest.schedule.map((trial) => trial.id))
	const files = await scanStudyTree(directory, '', known, manifest.bounds.series.bytes)
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
					(names[2] === 'attempt.json' || names[2] === 'evidence.jsonl'))
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
		const found = await scanStudyTree(directory, child, known, before)
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
