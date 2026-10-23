import type { StudyProfile } from '../../../../src/core/types.js'
import type { ScratchInterface } from '@orkestrel/test/server'
import type { StudyCommand } from '../../../../src/server/commands/StudyCommand.js'
import type {
	StudyExchangeHistory,
	StudySealedResult,
} from '../../../../src/server/stores/types.js'
import type { OllamaServerFixture } from '../ollama/types.js'

/** Holds an owned protocol-daemon consumer and its resolved profile. */
export interface StudyDaemonFixture {
	readonly scratch: ScratchInterface
	readonly profile: StudyProfile
	readonly url: string
	close(): Promise<void>
}

/** Holds a sealed open recording and its real command, worker, and protocol resources. */
export interface StudyReplayFixture {
	readonly scratch: ScratchInterface
	readonly entry: string
	readonly command: StudyCommand
	readonly server: OllamaServerFixture
	readonly recorded: string
	readonly result: StudySealedResult
	readonly history: StudyExchangeHistory
	readonly profile: StudyProfile
	close(): Promise<void>
}
