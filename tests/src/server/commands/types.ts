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

/** Holds a one-goal daemon recording with the executing scenario grown to its next goal. */
export interface StudyContinuationFixture extends StudyDaemonFixture {
	readonly entry: string
	readonly command: StudyCommand
	readonly recorded: string
	readonly result: StudySealedResult
	readonly history: StudyExchangeHistory
}

/** Names one independently altered declaration and its exact original bytes. */
export interface StudyContinuationRefusal {
	readonly name: string
	readonly path: string
	readonly original: string
	readonly changed: string
}

/** Describes an ancestor custody state that continuation must refuse. */
export interface StudyContinuationSource {
	readonly name: string
	readonly recording: boolean
	readonly declared: boolean
	readonly sealed: boolean
	readonly code: 'CONFIG' | 'CUSTODY'
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
