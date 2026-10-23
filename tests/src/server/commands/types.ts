import type { StudyProfile } from '../../../../src/core/types.js'
import type { ScratchInterface } from '@orkestrel/test/server'

/** Holds an owned protocol-daemon consumer and its resolved profile. */
export interface StudyDaemonFixture {
	readonly scratch: ScratchInterface
	readonly profile: StudyProfile
	readonly url: string
	close(): Promise<void>
}
