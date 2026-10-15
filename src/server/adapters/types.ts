import type {
	StudyAttempt,
	StudyDefinition,
	StudyDriverInterface,
	StudyEvidence,
	StudyJudgment,
	StudyManifest,
	StudyProfile,
	StudyRubric,
	StudyScenario,
} from '../../core/types.js'

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
}

/** Holds retained observations and independent criteria for a grading operation. */
export interface StudyAdjudication {
	readonly manifest: StudyManifest
	readonly rubric: StudyRubric
	readonly attempts: readonly StudyAttempt[]
	readonly evidence: Readonly<Record<string, readonly StudyEvidence[]>>
}

/** Defines the consumer's domain checks, driver construction, and retained-evidence grading.
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
}
