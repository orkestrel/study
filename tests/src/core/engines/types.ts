import type { StudyControl, StudyMeter, StudyScope } from '../../../../src/core/engines/index.js'

/** Holds real admission primitives and their owned cleanup boundary. */
export interface StudyMeterFixture {
	readonly control: StudyControl
	readonly scopes: readonly StudyScope[]
	readonly meter: StudyMeter
	close(): void
}
