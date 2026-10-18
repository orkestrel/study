import type { StudyEvidence, StudyJudgment } from '../../core/types.js'
import type {
	StudyAdapterInterface,
	StudyAdjudication,
	StudyGradeFunction,
	StudyGradeTarget,
	StudyReference,
} from './types.js'
import { isArray, isRecord } from '@orkestrel/contract'
import { StudyError } from '../../core/errors.js'
import { isStudyJudgment, isStudyRubric } from '../../core/validators.js'
import {
	isStudyCustodyAttempt,
	isStudyCustodyEvidence,
	isStudyCustodyManifest,
} from '../stores/validators.js'
import { isStudyAdapter } from './validators.js'

/** Reads a complete adapter from an admitted module namespace.
 * @param namespace - The captured consumer module.
 * @returns The validated adapter instance.
 */
export function readStudyAdapter(namespace: unknown): StudyAdapterInterface {
	if (!isRecord(namespace) || typeof namespace.createStudyAdapter !== 'function')
		throw new StudyError('CONFIG', 'Consumer module must export createStudyAdapter')
	const adapter: unknown = namespace.createStudyAdapter()
	if (!isStudyAdapter(adapter))
		throw new StudyError('CONFIG', 'Consumer factory returned an incomplete study adapter')
	return adapter
}

/**
 * Renders a citation of one retained trial file or evidence row.
 * @param target - The declared pair whose retained observations the citation must name
 * @param reference - The attempt file, the evidence file, or one zero-based evidence row
 * @returns The retained path, with a one-based row position for an evidence row
 * @throws StudyError - Thrown when the trial was not retained, or the citation names a row that does not exist or a row of the attempt file
 * @example Cite a retained evidence row
 * ```ts
 * import type { StudyGradeTarget } from '@orkestrel/study/server'
 * import { buildStudyReference } from '@orkestrel/study/server'
 *
 * declare const target: StudyGradeTarget
 *
 * buildStudyReference(target, { file: 'evidence', row: 0 }) // 'trials/r1-s1-a1/evidence.jsonl#1'
 * ```
 */
export function buildStudyReference(target: StudyGradeTarget, reference: StudyReference): string {
	if (!isRecord(reference)) throw new StudyError('EVIDENCE', 'Grading reference must be a record')
	if (target.attempt === undefined)
		throw new StudyError('EVIDENCE', 'Grading reference names a trial that was not retained')
	if (reference.file !== 'attempt' && reference.file !== 'evidence')
		throw new StudyError('EVIDENCE', 'Grading reference names an unknown retained file')
	const file = reference.file === 'attempt' ? 'attempt.json' : 'evidence.jsonl'
	const path = `trials/${target.trial.id}/${file}`
	if (reference.row === undefined) return path
	if (
		reference.file !== 'evidence' ||
		!Number.isSafeInteger(reference.row) ||
		reference.row < 0 ||
		reference.row >= target.evidence.length ||
		!isStudyCustodyEvidence(target.evidence[reference.row])
	)
		throw new StudyError('EVIDENCE', 'Grading reference names a retained row that does not exist')
	return `${path}#${reference.row + 1}`
}

/**
 * Grades every declared trial and criterion pair through the consumer's predicate.
 * @param input - The sealed declaration, retained attempts, retained evidence, and independent rubric
 * @param grade - The consumer's domain predicate; it supplies each verdict, method, reason, and citation
 * @returns One judgment for each declared pair, in schedule then rubric order, with one-based evidence references
 * @remarks
 * The traversal validates its input at this boundary, so a direct call retains the checks the
 * host also makes. A trial without a retained attempt still receives a judgment: the predicate
 * sees no attempt and no evidence, and missing evidence stays whatever verdict the consumer
 * reads from it. The traversal never decides success, and it cites nothing the retained
 * evidence cannot back.
 * @throws StudyError - Thrown when the rubric, declaration, attempts, or evidence are invalid or foreign, when a criterion names an undeclared goal, or when a reading is not a valid judgment
 * @example Grade retained evidence with a consumer predicate
 * ```ts
 * import type { StudyAdjudication, StudyGradeFunction } from '@orkestrel/study/server'
 * import { gradeStudyEvidence } from '@orkestrel/study/server'
 *
 * declare const input: StudyAdjudication
 * declare const grade: StudyGradeFunction
 *
 * gradeStudyEvidence(input, grade)
 * ```
 */
export function gradeStudyEvidence(
	input: StudyAdjudication,
	grade: StudyGradeFunction,
): readonly StudyJudgment[] {
	if (!isRecord(input)) throw new StudyError('CONFIG', 'Invalid grading input')
	const { manifest, rubric, attempts, evidence } = input
	if (!isStudyRubric(rubric)) throw new StudyError('CONFIG', 'Invalid grading rubric')
	if (!isStudyCustodyManifest(manifest))
		throw new StudyError('CONFIG', 'Invalid grading manifest or schedule')
	const schedule = manifest.schedule
	if (!isArray(attempts) || !attempts.every((attempt) => isStudyCustodyAttempt(attempt, manifest)))
		throw new StudyError('EVIDENCE', 'Invalid or duplicate grading attempts')
	const retained = new Map(attempts.map((attempt) => [attempt.trial.id, attempt]))
	if (retained.size !== attempts.length)
		throw new StudyError('EVIDENCE', 'Invalid or duplicate grading attempts')
	const known = new Set(schedule.map((trial) => trial.id))
	if (
		!isRecord(evidence) ||
		!Object.entries(evidence).every(
			([id, rows]) =>
				known.has(id) && isArray(rows) && Array.from(rows).every(isStudyCustodyEvidence),
		)
	)
		throw new StudyError('EVIDENCE', 'Invalid or foreign grading evidence')
	for (const criterion of rubric.criteria) {
		if (
			!manifest.scenarios.some(
				(scenario) =>
					scenario.id === criterion.scenario &&
					scenario.goals.some((goal) => goal.id === criterion.goal),
			)
		)
			throw new StudyError('CONFIG', 'Grading criterion references an undeclared goal')
	}
	// Iterators pull each trial and criterion only after the preceding predicate returned, so a
	// predicate that edits the caller's live arrays changes what the next judgment names.
	return Object.freeze(
		schedule
			.values()
			.flatMap((trial) => {
				const attempt = retained.get(trial.id)
				const rows: readonly StudyEvidence[] =
					attempt === undefined ? Object.freeze([]) : (evidence[trial.id] ?? Object.freeze([]))
				return rubric.criteria
					.values()
					.filter((criterion) => criterion.scenario === trial.scenario)
					.map((criterion): StudyJudgment => {
						const target: StudyGradeTarget = Object.freeze({
							trial,
							criterion,
							attempt,
							evidence: rows,
						})
						const reading = grade(target)
						if (!isRecord(reading) || !isArray(reading.references))
							throw new StudyError('EVIDENCE', 'Grading predicate returned an invalid reading')
						const judgment = {
							trial: trial.id,
							criterion: criterion.id,
							verdict: reading.verdict,
							method: reading.method,
							reason: reading.reason,
							references: Object.freeze(
								reading.references.map((reference) => buildStudyReference(target, reference)),
							),
						}
						if (!isStudyJudgment(judgment))
							throw new StudyError('EVIDENCE', 'Grading predicate returned an invalid judgment')
						return Object.freeze(judgment)
					})
			})
			.toArray(),
	)
}
