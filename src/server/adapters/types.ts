import type {
	StudyAttempt,
	StudyCriterion,
	StudyDefinition,
	StudyDriverInterface,
	StudyEvidence,
	StudyJudgment,
	StudyManifest,
	StudyProfile,
	StudyRubric,
	StudyScenario,
	StudyTrial,
} from '@src/core'
import type { JSONValue } from '@orkestrel/contract'
import type { StudyExchangeSinkInterface } from '../stores/types.js'
import type { StudyOllamaReplayInterface } from '../ollama/types.js'

/** Holds declarations for domain validation before agent, subject or provider execution. */
export interface StudyValidation {
	readonly definition: StudyDefinition
	readonly scenarios: readonly StudyScenario[]
	readonly rubric: StudyRubric
	readonly profile: StudyProfile
}

/** Supplies admitted modules and an exclusive scratch parent without grader truth. */
export interface StudyDriverOptions {
	readonly agent: unknown
	readonly subject: unknown
	readonly provider: unknown
	readonly profile: StudyProfile
	readonly directory: string
	/** Supplies the worker-owned sidecar sink whenever the profile declares recording. */
	readonly exchanges?: StudyExchangeSinkInterface
	/** Supplies verified replay whose fetch is passed to the transport inside this worker. */
	readonly replay?: StudyOllamaReplayInterface
}

/** Holds retained observations and independent criteria for a grading operation. */
export interface StudyAdjudication {
	readonly manifest: StudyManifest
	readonly rubric: StudyRubric
	readonly attempts: readonly StudyAttempt[]
	readonly evidence: Readonly<Record<string, readonly StudyEvidence[]>>
}

/** Names a retained file of one trial that a judgment cites. */
export type StudyReferenceFile = 'attempt' | 'evidence'

/** Cites a retained trial file, or one evidence row of it by its zero-based position. */
export interface StudyReference {
	readonly file: StudyReferenceFile
	/** Selects one retained evidence row; the cited string carries its one-based position. Valid only for the evidence file. */
	readonly row?: number
}

/** Holds one declared trial and criterion pair with its retained observations. */
export interface StudyGradeTarget {
	readonly trial: StudyTrial
	readonly criterion: StudyCriterion
	/** Holds the retained terminal record, or undefined when the trial was never retained. */
	readonly attempt: StudyAttempt | undefined
	/** Holds the trial's retained evidence rows in append order; empty when the trial was never retained. */
	readonly evidence: readonly StudyEvidence[]
}

/** Holds a consumer predicate's reading of one target, citing only retained files and rows. */
export interface StudyGradeVerdict {
	readonly verdict: StudyJudgment['verdict']
	readonly method: StudyJudgment['method']
	readonly reason: string
	readonly references: readonly StudyReference[]
}

/** Reads one declared target against the consumer's domain predicate. */
export type StudyGradeFunction = (target: StudyGradeTarget) => StudyGradeVerdict

/** Holds one listed goal of a scheduled trial with exactly that goal's complete evidence rows. */
export interface StudyProgressTarget {
	readonly trial: StudyTrial
	readonly goal: string
	/** Holds the goal's complete rows in append order, without rows of any other goal. */
	readonly evidence: readonly StudyEvidence[]
}

/** Projects a batch of listed goals into one adapter reading per target, in target order. */
export type StudyProgressFunction = (
	targets: readonly StudyProgressTarget[],
) => Promise<ReadonlyArray<JSONValue | undefined>>

/** Defines the consumer's domain checks, driver construction, and retained-evidence assessment.
 * @remarks
 * An authored module exports a createStudyAdapter factory returning this interface.
 * The host invokes adapter code in a bounded child. It passes criteria to validation
 * and grading only; a trial receives the admitted modules and its public input.
 * Adapter code is trusted instrumentation, not a security sandbox.
 */
export interface StudyAdapterInterface {
	/** Checks domain declarations before loading a selected agent, subject or provider.
	 * @param input - The generic declarations already parsed by the host.
	 */
	validate(input: StudyValidation): void
	/** Constructs the consumer's driver over admitted module namespaces.
	 * @param options - Modules, runtime profile, and owned scratch parent.
	 * @returns The actual driver used for this isolated trial.
	 */
	driver(options: StudyDriverOptions): StudyDriverInterface
	/** Judges retained evidence without changing the executed trajectory.
	 * @param input - The sealed observations and independently selected rubric.
	 * @returns Criterion readings; unavailable evidence remains unknown.
	 */
	grade(input: StudyAdjudication): readonly StudyJudgment[]
	/** Reads one listed goal's complete evidence into the adapter's own progress value.
	 * @remarks
	 * Optional. The host calls it in a bounded child once per listed goal, in trial then goal order.
	 * A thrown `StudyError` keeps its code and any other throw becomes `FAULT`; a return that is not
	 * a JSON value is `FAULT`. Either refuses the whole command and names the trial and goal.
	 * @param target - The trial, the goal, and exactly that goal's complete evidence rows.
	 * @returns A JSON value the progress document carries as the goal's reading.
	 */
	progress?(target: StudyProgressTarget): JSONValue
}
