import type { RecorderInterface } from '@orkestrel/test'
import type { StudyControl, StudyMeter, StudyScope } from '../../../../src/core/engines/index.js'
import type {
	StudyAttempt,
	StudyContext,
	StudyDriverInterface,
	StudyGoal,
	StudyProduct,
	StudyStoreInterface,
	StudyTrial,
} from '../../../../src/core/types.js'

/** Holds real admission primitives and their owned cleanup boundary. */
export interface StudyMeterFixture {
	readonly control: StudyControl
	readonly scopes: readonly StudyScope[]
	readonly meter: StudyMeter
	close(): void
}

/** Configures the consumer-side driver boundary fixture. */
export interface StudyDriverFixtureOptions {
	/** Replaces the default goal execution after the goal id is recorded. */
	readonly execute?: (goal: StudyGoal, context: StudyContext) => Promise<StudyProduct>
	/** Delays each open result until the caller resolves it. */
	readonly opening?: Promise<void>
}

/** Holds a driver whose every boundary call is recorded. */
export interface StudyDriverFixture {
	readonly driver: StudyDriverInterface
	readonly opened: RecorderInterface<readonly [StudyTrial]>
	readonly executed: RecorderInterface<readonly [string]>
	readonly closed: RecorderInterface<readonly [string]>
}

/** Holds an in-memory custody consumer whose every boundary call is recorded. */
export interface StudyStoreFixture {
	readonly store: StudyStoreInterface
	readonly started: RecorderInterface<readonly [StudyTrial]>
	readonly attempts: RecorderInterface<readonly [StudyAttempt]>
}
