import type {
	StudyDefinition,
	StudyFailure,
	StudyGrading,
	StudyIdentity,
	StudyProfile,
	StudyRubric,
	StudyScenario,
} from '@src/core'
import type { StudyArtifactLoader } from '../processes/StudyArtifactLoader.js'
import type { StudyPacketBundle } from '../stores/types.js'

/** Holds the trusted application entry and repository location. */
export interface StudyCommandOptions {
	readonly root: string
	readonly entry: string
}

/** Holds a checked execution selection with optional output custody. */
export interface StudyExecutionRequest {
	readonly command: 'check' | 'execute'
	readonly target: string
	readonly profile: string
	/** Selects an absolute output or a portable path contained by the consumer root. */
	readonly out: string | undefined
	readonly expected: string | undefined
}

/** Holds an offline predicate grading request. */
export interface StudyGradeRequest {
	readonly command: 'grade'
	readonly target: string
	readonly rubric: string
}

/** Holds an imported-label grading request. */
export interface StudyLabelRequest {
	readonly command: 'label'
	readonly target: string
	readonly grading: string
	readonly labels: string
}

/** Holds a selected immutable report request. */
export interface StudyReportRequest {
	readonly command: 'report'
	readonly target: string
	readonly grading: string
}

/** Names the independently dispatched study command operation. */
export type StudyCommandRequest =
	| StudyExecutionRequest
	| StudyGradeRequest
	| StudyLabelRequest
	| StudyReportRequest

/** Holds one bounded source artifact retained during offline validation. */
export interface StudyCommandArtifact {
	readonly path: string
	readonly digest: string
}

/**
 * Holds one failed record the report groups by cause, role, and layer.
 * @remarks
 * `trial` names the trial the failure belongs to. `goal` names the goal at the goal level and is
 * undefined at the trial level. `executed` is the record's own execution fact, never inferred.
 */
export interface StudyAttributionSource {
	readonly trial: string
	readonly goal: string | undefined
	readonly failure: StudyFailure
	readonly executed: boolean
}

/** Holds a parsed study declaration with its driver bundle, scenarios, scenario fixtures, and rubric. */
export interface StudyDeclaration {
	readonly bundle: string
	readonly definition: StudyDefinition
	readonly scenarios: readonly StudyScenario[]
	readonly fixtures: readonly StudyCommandArtifact[]
	readonly rubric: StudyRubric
}

/** Holds checked public declarations and reproducible executable identities. */
export interface StudyPreparation {
	readonly bundle: string
	readonly definition: StudyDefinition
	readonly scenarios: readonly StudyScenario[]
	readonly rubric: StudyRubric
	readonly profile: StudyProfile
	readonly identity: StudyIdentity
	readonly artifacts: StudyArtifactLoader
	readonly source: string
}

/** Holds artifacts already verified inside a selected immutable grading directory. */
export interface StudyGradingContext {
	readonly grading: StudyGrading
	readonly rubric: StudyRubric
	readonly bytes: Uint8Array
	readonly packet: StudyPacketBundle | undefined
	readonly labels: Uint8Array | undefined
}
