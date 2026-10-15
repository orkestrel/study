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
} from '../../core/types.js'
import type { StudyCommandArtifact } from './types.js'
import type { StudySealedResult } from '../stores/types.js'
import type { JSONValue } from '@orkestrel/contract'
import { parseJSON } from '@orkestrel/contract'
import { isAbsolute, join, resolve } from 'node:path'
import { STUDY_CAUSES, STUDY_ROLES } from '../../core/constants.js'
import { StudyError } from '../../core/errors.js'
import { computeStudyScores } from '../../core/helpers.js'
import { containsArtifact, encodeStudyJSON, hashStudyBytes } from '../helpers.js'
import { readStudyBytes } from '../stores/helpers.js'
import { isStudyCustodyEvidence } from '../stores/validators.js'
import { STUDY_RESERVED_NAME } from '../stores/constants.js'

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
 * @returns The reproducible resolved execution profile
 * @example
 * ```ts
 * resolveStudyProfile(root, profile)
 * ```
 */
export function resolveStudyProfile(root: string, profile: StudyProfile): StudyProfile {
	return {
		...profile,
		qualification:
			profile.qualification === undefined ? undefined : resolve(root, profile.qualification),
		agent: resolve(root, profile.agent),
		subject: resolve(root, profile.subject),
		roots: profile.roots.map((path) => resolve(root, path)),
		provider:
			profile.provider === undefined
				? undefined
				: { ...profile.provider, entry: resolve(root, profile.provider.entry) },
	}
}

/**
 * Computes the native supervisor's exact validated execution fingerprint.
 * @param identity - The reproducible executable identities
 * @param bounds - The validated nested execution limits
 * @param definition - The optional full declaration binding supervisor check to execute
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
): string {
	return hashStudyBytes(
		encodeStudyJSON({ identity, bounds, ...(definition === undefined ? {} : { definition }) }),
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
	const evidence: Record<string, readonly StudyEvidence[]> = {}
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
		const rows: StudyEvidence[] = []
		for (const line of text.split(/\r\n|\n/).slice(0, -1)) {
			const row = parseJSON(line)
			if (!isStudyCustodyEvidence(row)) throw new StudyError('CUSTODY', 'Evidence row is invalid')
			rows.push(row)
		}
		evidence[trial.id] = Object.freeze(rows)
	}
	return Object.freeze(evidence)
}

/**
 * Partitions records by their explicit execution fact without inferring any.
 * @param records - The attempts or observations to partition
 * @returns Counts of executed and unexecuted records, which sum to the record count
 * @example
 * ```ts
 * computeStudyPartition(attempts) // { executed: 2, unexecuted: 1 }
 * ```
 */
export function computeStudyPartition(
	records: ReadonlyArray<StudyAttempt | StudyObservation>,
): Readonly<Record<'executed' | 'unexecuted', number>> {
	return {
		executed: records.filter((record) => record.executed).length,
		unexecuted: records.filter((record) => !record.executed).length,
	}
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
