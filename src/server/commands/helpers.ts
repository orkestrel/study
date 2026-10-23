import type {
	StudyAttempt,
	StudyBounds,
	StudyDefinition,
	StudyEvidence,
	StudyGrading,
	StudyIdentity,
	StudyObservation,
	StudyProfile,
	StudyRubric,
	StudyScenario,
} from '@src/core'
import type { StudyAttributionSource, StudyCommandArtifact, StudyDeclaration } from './types.js'
import type { StudyClosure } from './types.js'
import type { ArtifactClosure } from '../artifacts/types.js'
import type { StudySealedResult } from '../stores/types.js'
import type { JSONValue } from '@orkestrel/contract'
import {
	STUDY_CAUSES,
	STUDY_LAYERS,
	STUDY_ROLES,
	StudyError,
	computeStudyScores,
	studyStopToJSON,
	parseStudyDefinition,
	parseStudyScenario,
	parseStudyRubric,
} from '@src/core'
import { parseJSON } from '@orkestrel/contract'
import { lstat } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
import {
	containsArtifact,
	decodeStudyJSON,
	encodeStudyJSON,
	hashStudyBytes,
	matchesSystemError,
} from '../helpers.js'
import { readStudyBytes } from '../stores/helpers.js'
import { isStudyCustodyEvidence } from '../stores/validators.js'
import { STUDY_CUSTODY_BYTES, STUDY_RESERVED_NAME } from '../stores/constants.js'
import { readArtifact, verifyArtifactClosure, relocateArtifactPath } from '../artifacts/helpers.js'
import { isStudyClosure } from './validators.js'

/** Reads and independently verifies an exclusively published closure.
 * @param directory - The canonical closure destination.
 * @returns The verified publication and its copied physical forest.
 * @throws StudyError - Thrown when publication or its command inputs are invalid.
 */
export function readStudyClosure(directory: string): StudyClosure {
	const marker = readArtifact(join(directory, 'closure.json'), STUDY_CUSTODY_BYTES)
	const value = decodeStudyJSON(marker.source)
	if (!isStudyClosure(value) || value.closure.destination !== directory)
		throw new StudyError('CONFIG', 'Study closure publication is invalid')
	verifyArtifactClosure(value.closure, true)
	if (
		(value.root !== directory && !containsArtifact(directory, value.root)) ||
		!value.closure.members.some(
			(member) => resolve(directory, ...member.key.split('/')) === value.entry,
		)
	)
		throw new StudyError('CONFIG', 'Study closure command inputs leave the copied forest')
	if (readArtifact(join(directory, 'closure.json'), STUDY_CUSTODY_BYTES).digest !== marker.digest)
		throw new StudyError('FAULT', 'Study closure publication changed while reading')
	return value
}

/** Resolves a profile path through a retained physical relocation when selected.
 * @param root - The active consumer root.
 * @param path - The profile's absolute or consumer-relative selection.
 * @param closure - The optional verified physical forest.
 * @returns The active canonical selection.
 */
export function resolveStudyClosurePath(
	root: string,
	path: string,
	closure?: ArtifactClosure,
): string {
	const absolute = resolve(root, path)
	return closure === undefined ||
		absolute === closure.destination ||
		containsArtifact(closure.destination, absolute)
		? absolute
		: relocateArtifactPath(closure, absolute)
}

/** Reads one declaration file and refuses a missing or linked path with its root-relative path.
 * @param root - The consumer root used to describe a missing or linked declaration.
 * @param path - The already resolved and contained declaration path.
 * @returns The exact declaration bytes under the custody metadata allowance.
 * @throws StudyError - Thrown with code `CONFIG` when the path is missing or linked; other custody refusals retain their codes.
 * @example Read declaration bytes
 * ```ts
 * import { readStudyDeclarationBytes } from '@orkestrel/study/server'
 *
 * declare const root: string
 * declare const path: string
 * await readStudyDeclarationBytes(root, path)
 * ```
 */
export async function readStudyDeclarationBytes(root: string, path: string): Promise<Uint8Array> {
	try {
		const absolute = resolve(path)
		const origin = parse(absolute).root
		const names = relative(origin, absolute).split(sep).filter(Boolean)
		// Classify consumer input before custody admission without traversing a linked ancestor.
		for (const [index] of names.entries()) {
			const candidate = join(origin, ...names.slice(0, index + 1))
			const stat = await lstat(candidate)
			if (stat.isSymbolicLink())
				throw new StudyError(
					'CONFIG',
					`Declaration path is linked: ${relative(root, candidate).split(sep).join('/')}`,
				)
			if (!stat.isDirectory()) break
		}
		return await readStudyBytes(path, STUDY_CUSTODY_BYTES)
	} catch (error) {
		if (matchesSystemError(error, 'ENOENT'))
			throw new StudyError(
				'CONFIG',
				`Declaration is missing: ${relative(root, path).split(sep).join('/')}`,
			)
		throw error
	}
}

/** Reads a study declaration, its driver's scenarios, and its rubric as the command resolves them.
 * @param root - The consumer root containing the studies directory.
 * @param study - The selected study name.
 * @param signal - Optional cancellation checked between scenario reads.
 * @returns The parsed declaration, driver bundle, ordered scenarios, fixtures, and selected rubric.
 * @throws StudyError - Thrown when declarations are missing, invalid, or incompatible.
 * @example Read a study declaration
 * ```ts
 * import type { StudyDeclaration } from '@orkestrel/study/server'
 * import { readStudyDeclaration } from '@orkestrel/study/server'
 *
 * declare const root: string
 * const declaration: StudyDeclaration = await readStudyDeclaration(root, 'assessment')
 * ```
 */
export async function readStudyDeclaration(
	root: string,
	study: string,
	signal?: AbortSignal,
): Promise<StudyDeclaration> {
	const directory = resolveStudyPath(join(root, 'studies'), study)
	const definition = parseStudyDefinition(
		decodeStudyJSON(
			await readStudyDeclarationBytes(root, resolveStudyPath(directory, 'study.json')),
		),
	)
	if (definition.name !== study)
		throw new StudyError('CONFIG', 'Study name differs from its selected directory')
	const bundle = resolveStudyPath(join(root, 'studies'), definition.driver)
	const steps: Array<{ readonly scenario: StudyScenario; readonly fixture: StudyCommandArtifact }> =
		[]
	for (const id of definition.scenarios) {
		signal?.throwIfAborted()
		const path = `scenarios/${id}.json`
		const bytes = await readStudyDeclarationBytes(root, resolveStudyPath(bundle, path))
		const scenario = parseStudyScenario(decodeStudyJSON(bytes))
		if (scenario.id !== id) throw new StudyError('CONFIG', 'Scenario identity is incompatible')
		steps.push({ scenario, fixture: { path, digest: hashStudyBytes(bytes) } })
	}
	const rubric = parseStudyRubric(
		decodeStudyJSON(
			await readStudyDeclarationBytes(root, resolveStudyPath(directory, definition.rubric)),
		),
	)
	return {
		bundle,
		definition,
		scenarios: Object.freeze(steps.map((step) => step.scenario)),
		fixtures: Object.freeze(steps.map((step) => step.fixture)),
		rubric,
	}
}

/**
 * Resolves a portable relative artifact path strictly inside its selected directory.
 * @param directory - The selected custody or study directory
 * @param path - The slash-separated relative artifact path
 * @returns The contained absolute host path
 * @throws StudyError - Thrown when a path is malformed, reserved, absolute, or escaping
 * @example
 * ```ts
 * resolveStudyPath(directory, 'profiles/local.json')
 * ```
 */
export function resolveStudyPath(directory: string, path: string): string {
	const names = path.split('/')
	if (
		path === '' ||
		isAbsolute(path) ||
		/[\\<>:"|?*]/.test(path) ||
		Array.from(path).some(
			(character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
		) ||
		names.some(
			(name) =>
				name === '' ||
				name === '.' ||
				name === '..' ||
				name.endsWith('.') ||
				name.endsWith(' ') ||
				STUDY_RESERVED_NAME.test(name.split('.')[0] ?? ''),
		)
	)
		throw new StudyError('CONFIG', 'Artifact path must be a portable contained relative path')
	const absolute = resolve(directory, ...names)
	if (!containsArtifact(resolve(directory), absolute))
		throw new StudyError('CONFIG', 'Artifact path escapes its selected directory')
	return absolute
}

/**
 * Resolves the execution profile's caller-selected built artifact paths.
 * @param root - The repository root
 * @param profile - The validated source profile
 * @param closure - The optional verified physical forest used to relocate executable selections
 * @returns The reproducible resolved execution profile
 * @example
 * ```ts
 * resolveStudyProfile(root, profile)
 * ```
 */
export function resolveStudyProfile(
	root: string,
	profile: StudyProfile,
	closure?: ArtifactClosure,
): StudyProfile {
	const daemon = profile.provider?.daemon
	if (
		daemon !== undefined &&
		(!isAbsolute(daemon.executable) || realpathSync(daemon.executable) !== daemon.executable)
	)
		throw new StudyError('CONFIG', 'Daemon executable must name its canonical absolute path')
	return {
		...profile,
		qualification:
			profile.qualification === undefined ? undefined : resolve(root, profile.qualification),
		agent: resolveStudyClosurePath(root, profile.agent, closure),
		subject: resolveStudyClosurePath(root, profile.subject, closure),
		roots: profile.roots.map((path) => resolveStudyClosurePath(root, path, closure)),
		provider:
			profile.provider === undefined
				? undefined
				: {
						...profile.provider,
						entry: resolveStudyClosurePath(root, profile.provider.entry, closure),
					},
	}
}

/**
 * Computes the native supervisor's exact validated execution fingerprint.
 * @param identity - The reproducible executable identities
 * @param bounds - The validated nested execution limits
 * @param definition - The optional full declaration binding supervisor check to execute
 * @param ancestor - The immediate ancestor seal when checking a continuation
 * @returns The fingerprint that execute must compare before any writes or child work
 * @example
 * ```ts
 * computeStudyCommandFingerprint(identity, bounds)
 * ```
 */
export function computeStudyCommandFingerprint(
	identity: StudyIdentity,
	bounds: StudyBounds,
	definition?: StudyDefinition,
	ancestor?: string,
): string {
	return hashStudyBytes(
		encodeStudyJSON({
			identity,
			bounds,
			...(definition === undefined ? {} : { definition }),
			...(ancestor === undefined ? {} : { ancestor }),
		}),
	)
}

/**
 * Computes public fixture identity from execution policy and exact scenario bytes.
 * @param definition - The complete retained study declaration
 * @param scenarios - The exact public scenario artifact identities
 * @returns The digest shared by compatible capacity and memory executions
 * @example
 * ```ts
 * computeStudyFixtureDigest(definition, scenarios)
 * ```
 */
export function computeStudyFixtureDigest(
	definition: StudyDefinition,
	scenarios: readonly StudyCommandArtifact[],
): string {
	return hashStudyBytes(
		encodeStudyJSON({
			driver: definition.driver,
			arms: definition.arms,
			order: definition.order,
			retries: definition.retries,
			scenarios,
		}),
	)
}

/**
 * Reads sealed evidence bytes through custody checks without loading executable code.
 * @param result - The independently verified sealed execution
 * @returns Evidence records keyed by scheduled trial identity
 * @throws StudyError - Thrown when evidence drifts, becomes partial, or fails validation
 * @example
 * ```ts
 * await collectStudyEvidence(result)
 * ```
 */
export async function collectStudyEvidence(
	result: StudySealedResult,
): Promise<Readonly<Record<string, readonly StudyEvidence[]>>> {
	const retained: Array<readonly [string, readonly StudyEvidence[]]> = []
	for (const trial of result.manifest.schedule) {
		const path = `trials/${trial.id}/evidence.jsonl`
		const file = result.seal.files.find((entry) => entry.path === path)
		const bytes = await readStudyBytes(
			join(result.directory, 'execution', 'trials', trial.id, 'evidence.jsonl'),
			result.manifest.bounds.trial.bytes,
		)
		if (file === undefined || hashStudyBytes(bytes) !== file.digest)
			throw new StudyError('CUSTODY', 'Evidence changed after execution verification')
		const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
		if (text !== '' && !text.endsWith('\n'))
			throw new StudyError('CUSTODY', 'Evidence is incomplete')
		const rows = text
			.split(/\r\n|\n/)
			.slice(0, -1)
			.map((line): StudyEvidence => {
				const row = parseJSON(line)
				if (!isStudyCustodyEvidence(row)) throw new StudyError('CUSTODY', 'Evidence row is invalid')
				return row
			})
		retained.push([trial.id, Object.freeze(rows)])
	}
	return Object.freeze(Object.fromEntries(retained))
}

/**
 * Partitions records by their explicit execution fact without inferring any.
 * @param records - The attempts, observations, or attribution sources to partition
 * @returns Counts of executed and unexecuted records, which sum to the record count
 * @example
 * ```ts
 * computeStudyPartition(attempts) // { executed: 2, unexecuted: 1 }
 * ```
 */
export function computeStudyPartition(
	records: ReadonlyArray<StudyAttempt | StudyObservation | StudyAttributionSource>,
): Readonly<Record<'executed' | 'unexecuted', number>> {
	return {
		executed: records.filter((record) => record.executed).length,
		unexecuted: records.filter((record) => !record.executed).length,
	}
}

/**
 * Groups failed records by cause, role, and layer, each group carrying its source readings.
 * @remarks
 * A group exists for each cause, role, and layer that holds at least one record. Groups follow
 * `STUDY_CAUSES`, then `STUDY_ROLES` with an absent role last, then `STUDY_LAYERS` with an absent
 * layer last. `role` and `layer` are null when absent. `executed` and `unexecuted` partition the
 * group by each record's own execution fact. `readings` lists every record of the group that carries
 * a stop, in source order, with `trial`, `goal` at the goal level only, `id`, `max`, and `consumed`
 * (null when the source reported none). A failure sealed before the `stop` member existed groups with
 * a null layer and no reading; the helper infers no layer from a message.
 * @param sources - The failed records, in source order
 * @returns The JSON groups
 * @example
 * ```ts
 * computeStudyAttributions([{ trial: 'r1-s1-a1', goal: undefined, failure, executed: true }])
 * ```
 */
export function computeStudyAttributions(sources: readonly StudyAttributionSource[]): JSONValue {
	return STUDY_CAUSES.flatMap((cause) =>
		[...STUDY_ROLES, undefined].flatMap((role) =>
			[...STUDY_LAYERS, undefined].flatMap((layer) => {
				const group = sources.filter(
					(source) =>
						source.failure.cause === cause &&
						source.failure.role === role &&
						source.failure.stop?.layer === layer,
				)
				if (group.length === 0) return []
				return [
					{
						cause,
						role: role ?? null,
						layer: layer ?? null,
						...computeStudyPartition(group),
						readings: group.flatMap((source) => {
							const stop = source.failure.stop
							return stop === undefined
								? []
								: [
										{
											trial: source.trial,
											...(source.goal === undefined ? {} : { goal: source.goal }),
											...Object.fromEntries(
												Object.entries(studyStopToJSON(stop) ?? {}).filter(
													([key]) => key !== 'layer',
												),
											),
										},
									]
						}),
					},
				]
			}),
		),
	)
}

/**
 * Computes whole-horizon results with operational costs and repetitions kept distinct.
 * @param result - The verified complete execution
 * @param rubric - The retained compatible rubric
 * @param grading - The independently verified selected grading
 * @returns The JSON report without pooling identities or inventing absent measurements
 * @remarks
 * Operations count affected trial and goal records, not independent failure events, and the
 * trial and goal counts overlap and are never added. Completion is operational: a goal is
 * completed when it holds a non-partial product and no failure, and a trial when it holds no
 * failure and every goal completed. It is neither task success nor a qualification gate.
 * @example
 * ```ts
 * computeStudyReport(result, rubric, grading)
 * ```
 */
export function computeStudyReport(
	result: StudySealedResult,
	rubric: StudyRubric,
	grading: StudyGrading,
): JSONValue {
	const scores = computeStudyScores(result.manifest, rubric, grading)
	const observations = result.attempts.flatMap((attempt) => attempt.observations)
	const usage = observations.flatMap((observation) => observation.usage)
	const completed = new Set(
		observations.filter(
			(observation) =>
				observation.product !== undefined &&
				!observation.product.partial &&
				observation.failure === undefined,
		),
	)
	const repetitions = result.manifest.definition.order.map((order, repetition) => ({
		repetition,
		order: [...order],
		arms: result.manifest.definition.arms.map((arm) => {
			const trials = new Set(
				result.manifest.schedule
					.filter((trial) => trial.repetition === repetition && trial.arm === arm)
					.map((trial) => trial.id),
			)
			const applicable = result.manifest.schedule
				.filter((trial) => trials.has(trial.id))
				.flatMap((trial) =>
					rubric.criteria
						.filter((criterion) => criterion.scenario === trial.scenario)
						.map((criterion) => ({ trial: trial.id, criterion })),
				)
			const judgments = applicable.map((pair) => ({
				criterion: pair.criterion,
				judgment: grading.judgments.find(
					(entry) => entry.trial === pair.trial && entry.criterion === pair.criterion.id,
				),
			}))
			const achieved = judgments.filter((entry) => entry.judgment?.verdict === 'achieved').length
			const unsuccessful = judgments.filter(
				(entry) => entry.judgment?.verdict === 'unsuccessful',
			).length
			const unknown = applicable.length - achieved - unsuccessful
			return {
				arm,
				total: applicable.length,
				achieved,
				unsuccessful,
				unknown,
				critical: judgments.filter(
					(entry) => entry.criterion.critical && entry.judgment?.verdict === 'unsuccessful',
				).length,
				lower: achieved / applicable.length,
				upper: (achieved + unknown) / applicable.length,
				coverage: (achieved + unsuccessful) / applicable.length,
			}
		}),
	}))
	const identity = result.manifest.identity
	return {
		command: 'report',
		result: result.manifest.id,
		seal: result.seal.id,
		identity: {
			agent: identity.agent,
			subject: identity.subject,
			instrument: identity.instrument,
			fixtures: identity.fixtures,
			profile: identity.profile,
			...(identity.provider === undefined ? {} : { provider: identity.provider }),
		},
		purpose: result.manifest.definition.purpose,
		population: 'Complete declared trial and criterion horizon',
		uncertainty:
			repetitions.length === 1
				? 'One repetition is descriptive and does not establish replicated capacity or quality.'
				: 'Repetitions are retained separately; intervals represent unresolved grading, not statistical confidence.',
		scores: scores.map((score) => ({ ...score })),
		repetitions,
		operations: {
			trials: {
				scheduled: result.manifest.schedule.length,
				terminal: result.attempts.length,
				...computeStudyPartition(result.attempts),
				completed: result.attempts.filter(
					(attempt) =>
						attempt.failure === undefined &&
						attempt.observations.every((observation) => completed.has(observation)),
				).length,
				faults: STUDY_CAUSES.map((cause) => ({
					cause,
					...computeStudyPartition(
						result.attempts.filter((attempt) => attempt.failure?.cause === cause),
					),
				})),
				attributions: computeStudyAttributions(
					result.attempts.flatMap((attempt) =>
						attempt.failure === undefined
							? []
							: [
									{
										trial: attempt.trial.id,
										goal: undefined,
										failure: attempt.failure,
										executed: attempt.executed,
									},
								],
					),
				),
			},
			goals: {
				scheduled: observations.length,
				...computeStudyPartition(observations),
				products: observations.filter((observation) => observation.product !== undefined).length,
				partial: observations.filter((observation) => observation.product?.partial === true).length,
				completed: observations.filter((observation) => completed.has(observation)).length,
				faults: STUDY_CAUSES.map((cause) => ({
					cause,
					...computeStudyPartition(
						observations.filter((observation) => observation.failure?.cause === cause),
					),
				})),
				attributions: computeStudyAttributions(
					result.attempts.flatMap((attempt) =>
						attempt.observations.flatMap((observation) =>
							observation.failure === undefined
								? []
								: [
										{
											trial: attempt.trial.id,
											goal: observation.goal,
											failure: observation.failure,
											executed: observation.executed,
										},
									],
						),
					),
				),
			},
		},
		costs: {
			duration: result.attempts.reduce((total, attempt) => total + attempt.duration, 0),
			roles: STUDY_ROLES.map((role) => {
				const charges = usage.filter((entry) => entry.role === role)
				return {
					role,
					measurements: charges.length,
					calls: charges.reduce((total, entry) => total + entry.calls, 0),
					duration: charges.reduce((total, entry) => total + entry.duration, 0),
					tokens: {
						known: charges.reduce((total, entry) => total + (entry.tokens ?? 0), 0),
						unknown: charges.filter((entry) => entry.tokens === undefined).length,
					},
					bytes: {
						known: charges.reduce((total, entry) => total + (entry.bytes ?? 0), 0),
						unknown: charges.filter((entry) => entry.bytes === undefined).length,
					},
				}
			}),
		},
	}
}
