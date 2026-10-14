import type {
	StudyAttempt,
	StudyManifest,
	StudyProduct,
	StudySinkInterface,
	StudyStoreInterface,
} from '../../core/types.js'
import type { FileHandle } from 'node:fs/promises'
import type { JSONValue } from '@orkestrel/contract'

/** Holds the inert execution store configuration. */
export interface StudyResultOptions {
	readonly directory: string
	readonly manifest: StudyManifest
}

/** Owns execution custody from exclusive creation through complete sealing. */
export interface StudyResultsInterface extends StudyStoreInterface {
	/** Exclusively creates the result directory and initial manifest bytes.
	 * @returns A promise that resolves after the manifest is synchronized.
	 */
	create(): Promise<void>
	/** Seals a complete terminal population with its exact execution-byte inventory.
	 * @returns The synchronized execution seal.
	 */
	seal(): Promise<StudySeal>
}

/** Holds the exact byte identity of one execution file. */
export interface StudyFile {
	readonly path: string
	readonly bytes: number
	readonly digest: string
}

/** Holds a complete execution inventory and its deterministic identity. */
export interface StudySeal {
	readonly version: 1
	readonly result: string
	readonly id: string
	readonly files: readonly StudyFile[]
}

/** Holds inspected execution metadata that is never gradeable before sealing. */
export interface StudyInterruptedResult {
	readonly status: 'interrupted'
	readonly directory: string
	readonly manifest: StudyManifest | undefined
	readonly attempts: readonly StudyAttempt[]
}

/** Holds independently verified sealed execution bytes. */
export interface StudySealedResult {
	readonly status: 'sealed'
	readonly directory: string
	readonly manifest: StudyManifest
	readonly attempts: readonly StudyAttempt[]
	readonly seal: StudySeal
}

/** Holds an offline execution reading discriminated by custody completeness. */
export type StudyResultReading = StudyInterruptedResult | StudySealedResult

/** Holds imported grading artifacts independently of execution. */
export interface StudyGradingOptions {
	readonly result: StudySealedResult
	readonly rubric: Uint8Array
	readonly labels?: Uint8Array
	readonly packet?: StudyPacketBundle
}

/** Holds exact neutral public packet bytes and private mapping bytes. */
export interface StudyPacketBundle {
	readonly content: Uint8Array
	readonly mapping: Uint8Array
}

/** Holds one neutral semantic grading input without treatment or model identifiers. */
export interface StudyPacketEntry {
	readonly trial: string
	readonly criterion: string
	readonly input: JSONValue
	readonly product: StudyProduct | undefined
	readonly assertion: JSONValue
}

/** Holds the neutral identity mapping to a sealed semantic trial-criterion pair. */
export interface StudyPacketLink {
	readonly trial: string
	readonly criterion: string
	readonly source: {
		readonly trial: string
		readonly criterion: string
	}
}

/** Holds the evidence sink's shared admission budget. */
export interface StudyCustodyBudget {
	readonly reserve: (bytes: number) => void
}

/** Holds the trial sink's admitted writes and terminal lifecycle. */
export interface StudyTrialCustody {
	readonly sink: StudyCustodySinkInterface
	readonly terminal: Promise<void> | undefined
}

/** Closes evidence admission and drains already admitted appends. */
export interface StudyCustodySinkInterface extends StudySinkInterface {
	/** Closes admission immediately and synchronizes all previously admitted writes.
	 * @returns A promise that resolves after the evidence descriptor closes.
	 */
	close(): Promise<void>
}

/** Holds the owned evidence descriptor and byte admission constraints. */
export interface StudyEvidenceOptions {
	readonly file: FileHandle
	readonly goals: readonly string[]
	readonly goal: number
	readonly trial: number
	readonly budget: StudyCustodyBudget
}

/** Names the execution custody lifecycle without inferring seal completeness. */
export type StudyCustodyPhase = 'new' | 'creating' | 'ready' | 'sealing' | 'sealed' | 'failed'
