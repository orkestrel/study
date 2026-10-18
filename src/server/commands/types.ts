import type {
	StudyDefinition,
	StudyGrading,
	StudyIdentity,
	StudyProfile,
	StudyRubric,
	StudyScenario,
} from '../../core/types.js'
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

/** Holds checked public declarations and reproducible executable identities. */
export interface StudyPreparation {
	readonly directory: string
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
