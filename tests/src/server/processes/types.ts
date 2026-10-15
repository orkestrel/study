import type { ChildProcess } from 'node:child_process'
import type { StudyTask } from '../../../../src/server/processes/StudyTask.js'

/** Holds one forked protocol peer and its bounded release. */
export interface StudyPeerFixture {
	readonly child: ChildProcess
	close(): Promise<void>
}

/** Names how a fixture adapter answers its one request. */
export type StudyTaskMode = 'valid' | 'malformed' | 'repeated' | 'combined-output' | 'hold'

/** Holds one task over a scripted adapter and the scratch file recording the adapter's pid. */
export interface StudyTaskFixture {
	readonly task: StudyTask
	readonly pid: string
}

/** Records the exited fixture root and the detached leaf that outlives it. */
export interface StudyOrphanReceipt {
	readonly root: number
	readonly leaf: number
}
