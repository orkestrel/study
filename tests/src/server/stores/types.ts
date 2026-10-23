/** Declares one terminal record shape against the custody decision it must receive. */
export interface StudyExecutionCase {
	/** Names the case in the test title. */
	readonly name: string
	/** If `true`, custody accepts the attempt; if `false`, custody refuses it. */
	readonly valid: boolean
	/** Replaces the fields of a fully executed attempt for the compact scenario's two goals; malformed members stay unknown and inert. */
	readonly attempt: Readonly<Record<string, unknown>>
}

/** Names an independently malformed exchange journal fixture. */
export type StudyExchangeMutation =
	| 'complete'
	| 'missing-response'
	| 'missing-metadata'
	| 'duplicate'
	| 'orphan'
	| 'open'
	| 'partial'
	| 'reversed'
	| 'altered'
	| 'incomplete'
	| 'failed'
	| 'outside-goal'
	| 'backward-goal'
	| 'postflight-goal'
	| 'count'
	| 'goals'
	| 'record'
import type { StudyManifest } from '../../../../src/core/types.js'
import type { StudyResultStoreInterface } from '../../../../src/server/stores/types.js'

/** Holds the real store and complete fixture population before sealing. */
export interface StudyExchangeCustodyFixture {
	readonly store: StudyResultStoreInterface
	readonly manifest: StudyManifest
	readonly directory: string
}
