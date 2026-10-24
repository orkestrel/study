import type { ChildProcess } from 'node:child_process'
import type { StudyTask } from '../../../../src/server/processes/StudyTask.js'
import type { StudyChannel } from '../../../../src/server/processes/StudyChannel.js'

/** Holds one forked protocol peer and its bounded release. */
export interface StudyPeerFixture {
	readonly child: ChildProcess
	close(): Promise<void>
}

/** Holds a real worker with a direct parent channel and bounded tree cleanup. */
export interface StudyWorkerFixture extends StudyPeerFixture {
	readonly channel: StudyChannel
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

/** Holds one installed Agent fixture package, its built entry, and its evaluation log. */
export interface StudyAgentFixture {
	readonly root: string
	readonly entry: string
	readonly log: string
}

/** Holds the agent identity and fingerprint a supervisor check printed. */
export interface StudyCheckReading {
	readonly agent: string
	readonly fingerprint: string
}
