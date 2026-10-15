import type { RecorderInterface } from '@orkestrel/test'
import type { StudyControl, StudyMeter, StudyScope } from '../../../../src/core/engines/index.js'
import type { StudyError } from '../../../../src/core/errors.js'
import type {
	StudyAttempt,
	StudyContext,
	StudyDriverInterface,
	StudyFailure,
	StudyGoal,
	StudyProduct,
	StudyStoreInterface,
	StudyTrial,
} from '../../../../src/core/types.js'

/** Holds a separately evaluated copy of the real study error module. */
export interface StudyErrorCopy {
	/** Holds the copy's own error class. */
	readonly error: unknown
	/** Constructs an error through the copy's own class. */
	readonly create: (...values: ConstructorParameters<typeof StudyError>) => unknown
	/** Applies the copy's own error guard. */
	readonly recognize: (value: unknown) => boolean
}

/** Declares one driver result against the output admission it must meet. */
export interface StudyAdmissionCase {
	/** Names the case in the test title. */
	readonly name: string
	/** If `true`, the driver outlasts the goal duration before it returns. */
	readonly expired: boolean
	/** If `true`, the returned value exceeds the goal output allowance. */
	readonly oversized: boolean
	/** Names the cause the first terminal failure must carry. */
	readonly cause: StudyFailure['cause']
	/** Holds the product the first observation must retain. */
	readonly product: StudyProduct | undefined
}

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
	/** Rejects each open with the supplied error after the call is recorded. */
	readonly refuse?: Error
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
