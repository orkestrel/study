import type { ChildProcess } from 'node:child_process'

/** Holds one forked protocol peer and its bounded release. */
export interface StudyPeerFixture {
	readonly child: ChildProcess
	close(): Promise<void>
}
