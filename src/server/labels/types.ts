import type { StudyJudgment, StudyLabels } from '@src/core'
import type { JSONValue } from '@orkestrel/contract'

/** Holds one sealed segment's retained packet and mapping bytes and the arm it belongs to. */
export interface StudyLabelSegment {
	/** Holds the sealed result's seal id, which the mapping names. */
	readonly result: string
	readonly arm: string
	readonly packet: Uint8Array
	readonly mapping: Uint8Array
}

/** Holds one authored fictional row that catches an inattentive labeler. */
export interface StudyLabelControl {
	readonly input: JSONValue
	readonly product: JSONValue
	readonly assertion: JSONValue
	readonly verdict: StudyJudgment['verdict']
}

/** Names the source pair a neutral row stands for. */
export interface StudyLabelSource {
	readonly trial: string
	readonly criterion: string
}

/**
 * Holds the goal a criterion grades and the class an agreement reads it under.
 * @remarks
 * A packet names no goal and no class, so the consumer that owns its rubric's naming supplies both.
 */
export interface StudyLabelPartition {
	readonly goal: string
	readonly class: string
}

/**
 * Reads the goal and class of one source pair.
 * @param source - The source pair
 * @returns The partition, or undefined when the consumer's rubric names none, which refuses the pool
 */
export type StudyLabelPartitionFunction = (
	source: StudyLabelSource,
) => StudyLabelPartition | undefined

/**
 * Holds what a pool repeats for and how it reads a packet.
 * @remarks
 * `order` is the text the pool's order repeats for and moves with. `controls` are seated among the
 * requests and marked in the map alone. `partition` reads each source pair's goal and class.
 */
export interface StudyLabelPoolOptions {
	readonly order: string
	readonly controls: readonly StudyLabelControl[]
	readonly partition: StudyLabelPartitionFunction
}

/** Holds the one row text a labeler reads; a goal that failed holds no `product`. */
export interface StudyLabelRow {
	readonly row: number
	readonly input: JSONValue
	readonly product?: JSONValue
	readonly assertion: JSONValue
}

/** Holds the rows one blind labeler answers together. */
export interface StudyLabelBatch {
	readonly rows: readonly StudyLabelRow[]
}

/** Links one neutral row to its packet identities and its source pair. */
export interface StudyLabelLink extends StudyLabelPartition {
	readonly row: number
	/** Holds the index of the request that shows the row. */
	readonly request: number
	/** Holds the packet bytes' digest, which the row's labels bind. */
	readonly packet: string
	readonly result: string
	readonly arm: string
	readonly trial: string
	readonly criterion: string
	readonly source: StudyLabelSource
}

/** Links one control's neutral row to the verdict its authored text states. */
export interface StudyLabelCheck {
	readonly row: number
	readonly request: number
	readonly verdict: StudyJudgment['verdict']
}

/** Holds what a labeler must not see: each row's identity, and which rows are controls. */
export interface StudyLabelMap {
	readonly links: readonly StudyLabelLink[]
	readonly checks: readonly StudyLabelCheck[]
}

/** Holds a pool's blind requests and their separate map. */
export interface StudyLabelPool {
	readonly requests: readonly StudyLabelBatch[]
	readonly map: StudyLabelMap
}

/** Holds one packet entry's pooling group, row text, and identities. */
export interface StudyLabelMember {
	readonly group: string
	readonly text: Omit<StudyLabelRow, 'row'>
	readonly link: Omit<StudyLabelLink, 'row' | 'request'>
}

/** Holds one row before its number: a packet entry holds a `link`, and a control holds a `verdict`. */
export interface StudyLabelSeat {
	readonly rank: string
	readonly request: number
	readonly text: Omit<StudyLabelRow, 'row'>
	readonly link?: Omit<StudyLabelLink, 'row' | 'request'>
	readonly verdict?: StudyJudgment['verdict']
}

/** Holds one public evidence row a prompt shows beside its request. */
export interface StudyLabelReceipt {
	readonly event: string
	readonly value: JSONValue
}

/** Holds one row a labeler returned. */
export interface StudyLabelAnswer {
	readonly row: number
	readonly verdict: StudyJudgment['verdict']
	readonly reason: string
	/** Holds whether the labeler flagged the row's text as revealing its arm. */
	readonly revealed?: boolean
}

/** Holds what one labeler returned across its requests. */
export interface StudyLabelLane {
	readonly labeler: string
	readonly rows: readonly StudyLabelAnswer[]
}

/** Holds what a labels file states beside its judgments, and the lane that settles disputes. */
export interface StudyLabelImportOptions {
	readonly created: string
	readonly version: string
	readonly third?: StudyLabelLane
}

/** Holds the labels files of a pool and what their rows came to. */
export interface StudyLabelImport {
	/** Holds one file per packet. */
	readonly labels: readonly StudyLabels[]
	/** Counts each lane's row that is absent or carries a blank reason, controls aside. */
	readonly omitted: number
	/** Lists the rows the labeling lanes disagree on, before any third lane. */
	readonly disputes: readonly number[]
	/** Counts, per lane in order, the controls it omitted or answered against the authored verdict. */
	readonly missed: readonly number[]
}

/** Holds two lanes' agreement over one class. */
export interface StudyLabelAgreement {
	readonly class: string
	readonly count: number
	readonly agreement: number
	/** Holds Cohen's kappa over the three verdicts; undefined when chance agreement is 1. */
	readonly kappa: number | undefined
	/** Holds both-achieved over either-achieved; undefined when neither side holds an `achieved`. */
	readonly overlap: number | undefined
}
