import type { StudyFailure, StudyStop } from '../../../../src/core/types.js'
import { Budget, BudgetError } from '@orkestrel/budget'
import {
	computeStudyAdmittedStop,
	computeStudyOutputStop,
} from '../../../../src/core/engines/helpers.js'
import { waitForAbort } from '@orkestrel/test'
import { describe, expect, it } from 'vitest'
import { StudyError } from '../../../../src/core/errors.js'
import {
	failStudyTicket,
	failureToStudyError,
	readStudyFailure,
} from '../../../../src/core/engines/helpers.js'
import { createStudyMeterFixture, importStudyErrorCopy } from '../../../setupStudy.js'

describe('study engine error attribution', () => {
	it('retains attribution from a stop implemented through inherited class accessors', () => {
		class Ceiling implements StudyStop {
			get layer(): 'model' {
				return 'model'
			}
			get id(): string {
				return 'num_predict'
			}
			get max(): number {
				return 100
			}
			get consumed(): number {
				return 101
			}
		}
		const failure: StudyFailure = {
			cause: 'capacity',
			message: 'Reached',
			role: 'agent',
			stop: new Ceiling(),
		}
		const reading = readStudyFailure(new StudyError('CAPACITY', 'Class stop', failure))
		expect(reading).toBe(failure)
		expect(reading.cause).toBe('capacity')
		expect(reading.message).toBe('Reached')
		expect(reading.role).toBe('agent')
		expect(reading.stop).toBe(failure.stop)
	})

	it('preserves an existing operational reading and classifies uncategorized errors', () => {
		const failure = {
			cause: 'capacity',
			message: 'No request room',
			role: 'agent',
			stop: undefined,
		} as const
		const error = failureToStudyError(failure)
		expect(error).toBeInstanceOf(StudyError)
		expect(error.code).toBe('CAPACITY')
		expect(readStudyFailure(error)).toBe(failure)
		expect(failureToStudyError({ ...failure, cause: 'deadline' }).code).toBe('DEADLINE')
		expect(failureToStudyError({ ...failure, cause: 'interrupted' }).code).toBe('FAULT')
		expect(readStudyFailure(new Error('Disk refused'))).toEqual({
			cause: 'infrastructure',
			message: 'Disk refused',
			role: undefined,
		})
		expect(readStudyFailure(undefined).cause).toBe('infrastructure')
	})

	it('preserves refused completed content with its cause and role through the FAULT code', () => {
		const failure: StudyFailure = {
			cause: 'content',
			message: 'Summary content was unusable',
			role: 'summary',
			stop: undefined,
		}
		const error = failureToStudyError(failure)
		expect(error.code).toBe('FAULT')
		expect(error.message).toBe(failure.message)
		expect(readStudyFailure(error)).toBe(failure)
		expect(readStudyFailure(error)).toEqual({
			cause: 'content',
			message: failure.message,
			role: 'summary',
		})
		expect(readStudyFailure(new StudyError('FAULT', 'Summary content was unusable')).cause).toBe(
			'infrastructure',
		)
	})

	it('attributes a bare capacity error to capacity', () => {
		expect(readStudyFailure(new StudyError('CAPACITY', 'No request room'))).toEqual({
			cause: 'capacity',
			message: 'No request room',
			role: undefined,
		})
	})

	it('attributes a bare deadline error to the deadline', () => {
		expect(readStudyFailure(new StudyError('DEADLINE', 'Goal timer elapsed'))).toEqual({
			cause: 'deadline',
			message: 'Goal timer elapsed',
			role: undefined,
		})
	})

	it('prefers an explicit reading over the code and retains its identity', () => {
		const failure: StudyFailure = {
			cause: 'interrupted',
			message: 'Series stopped',
			role: 'agent',
			stop: undefined,
		}
		expect(readStudyFailure(new StudyError('CAPACITY', 'No request room', failure))).toBe(failure)
		expect(readStudyFailure(new StudyError('DEADLINE', 'Goal timer elapsed', failure))).toBe(
			failure,
		)
	})

	it('keeps the remaining codes and foreign rejections infrastructure', () => {
		expect(readStudyFailure(new StudyError('FAULT', 'Adapter crashed'))).toEqual({
			cause: 'infrastructure',
			message: 'Adapter crashed',
			role: undefined,
		})
		expect(readStudyFailure(new StudyError('CONFIG', 'Missing arm')).cause).toBe('infrastructure')
		expect(readStudyFailure(new StudyError('EVIDENCE', 'Torn record')).cause).toBe('infrastructure')
		expect(readStudyFailure(new StudyError('CUSTODY', 'Write refused')).cause).toBe(
			'infrastructure',
		)
		expect(readStudyFailure(new Error('Disk refused')).cause).toBe('infrastructure')
		expect(readStudyFailure('CAPACITY').cause).toBe('infrastructure')
	})

	it('attributes errors a distinct study module copy constructs', async () => {
		const copy = await importStudyErrorCopy('helpers-attribution')
		expect(readStudyFailure(copy.create('CAPACITY', 'No request room'))).toEqual({
			cause: 'capacity',
			message: 'No request room',
			role: undefined,
		})
		expect(readStudyFailure(copy.create('DEADLINE', 'Goal timer elapsed'))).toEqual({
			cause: 'deadline',
			message: 'Goal timer elapsed',
			role: undefined,
		})
		const failure: StudyFailure = {
			cause: 'capacity',
			message: 'Context full',
			role: 'agent',
			stop: undefined,
		}
		expect(readStudyFailure(copy.create('FAULT', 'Request rejected', failure))).toBe(failure)
		expect(readStudyFailure(copy.create('FAULT', 'Adapter crashed'))).toEqual({
			cause: 'infrastructure',
			message: 'Adapter crashed',
			role: undefined,
		})
		expect(readStudyFailure(copy.create('CONFIG', 'Missing arm')).cause).toBe('infrastructure')
	})

	it('does not trust a lookalike that is not a study error', () => {
		const lookalike = Object.assign(new Error('Claims capacity'), {
			name: 'StudyError',
			code: 'CAPACITY',
		})
		const structural = { name: 'StudyError', code: 'DEADLINE', message: 'Claims deadline' }
		expect(readStudyFailure(lookalike)).toEqual({
			cause: 'infrastructure',
			message: 'Claims capacity',
			role: undefined,
		})
		expect(readStudyFailure(structural)).toEqual({
			cause: 'infrastructure',
			message: 'Study operation rejected without an Error',
			role: undefined,
		})
	})
})

describe('failStudyTicket', () => {
	it('fails a pending local ticket once, derives its settlement, and accounts the request once', () => {
		const fixture = createStudyMeterFixture()
		try {
			const ticket = fixture.meter.admit({ role: 'judge', tokens: 8, bytes: 8 })
			expect(ticket.settled).toBe(false)
			failStudyTicket(ticket, new Error('Provider refused'))
			expect(ticket.settled).toBe(true)
			expect(fixture.control.failure).toEqual({
				cause: 'infrastructure',
				message: 'Provider refused',
				role: 'judge',
			})
			expect(fixture.meter.usage).toMatchObject([
				{ role: 'judge', calls: 1, tokens: undefined, bytes: undefined },
			])
			failStudyTicket(ticket, new Error('Cleanup also failed'))
			expect(fixture.meter.usage).toHaveLength(1)
			expect(fixture.control.failure?.message).toBe('Provider refused')
		} finally {
			fixture.close()
		}
	})

	it('applies the existing normalization to a bare capacity error and an unattributed rejection', () => {
		const fixture = createStudyMeterFixture()
		try {
			const ticket = fixture.meter.admit({ role: 'agent', tokens: 8, bytes: 8 })
			failStudyTicket(ticket, new StudyError('CAPACITY', 'No request room'))
			expect(fixture.control.failure).toEqual({
				cause: 'capacity',
				message: 'No request room',
				role: 'agent',
			})
		} finally {
			fixture.close()
		}
		const rejected = createStudyMeterFixture()
		try {
			failStudyTicket(rejected.meter.admit({ role: 'tool', tokens: 0, bytes: 0 }), undefined)
			expect(rejected.control.failure).toEqual({
				cause: 'infrastructure',
				message: 'Study operation rejected without an Error',
				role: 'tool',
			})
		} finally {
			rejected.close()
		}
	})

	it('keeps a carried foreign role by default and lets an explicit role replace it', () => {
		const foreign = new StudyError('FAULT', 'Judge refused', {
			cause: 'infrastructure',
			message: 'Judge refused',
			role: 'judge',
			stop: undefined,
		})
		const carried = createStudyMeterFixture()
		try {
			failStudyTicket(carried.meter.admit({ role: 'tool', tokens: 0, bytes: 0 }), foreign)
			expect(carried.control.failure).toEqual({
				cause: 'infrastructure',
				message: 'Judge refused',
				role: 'judge',
			})
		} finally {
			carried.close()
		}
		const explicit = createStudyMeterFixture()
		try {
			failStudyTicket(explicit.meter.admit({ role: 'tool', tokens: 0, bytes: 0 }), foreign, 'tool')
			expect(explicit.control.failure).toEqual({
				cause: 'infrastructure',
				message: 'Judge refused',
				role: 'tool',
			})
			expect(explicit.meter.usage).toMatchObject([{ role: 'tool', calls: 1 }])
		} finally {
			explicit.close()
		}
	})

	it('ignores an explicit role on a settled ticket', () => {
		const fixture = createStudyMeterFixture()
		try {
			const ticket = fixture.meter.admit({ role: 'agent', tokens: 8, bytes: 8 })
			ticket.finish({ role: 'agent', calls: 1, tokens: 1, bytes: 1, duration: 1 })
			failStudyTicket(ticket, new Error('Late failure'), 'tool')
			expect(fixture.control.failure).toBeUndefined()
			expect(fixture.meter.usage).toHaveLength(1)
		} finally {
			fixture.close()
		}
	})

	it('leaves a ticket that already finished untouched', () => {
		const fixture = createStudyMeterFixture()
		try {
			const ticket = fixture.meter.admit({ role: 'agent', tokens: 8, bytes: 8 })
			ticket.finish({ role: 'agent', calls: 1, tokens: 1, bytes: 1, duration: 1 })
			expect(ticket.settled).toBe(true)
			failStudyTicket(ticket, new Error('Late failure'))
			expect(fixture.meter.usage).toMatchObject([{ role: 'agent', tokens: 1, bytes: 1 }])
			expect(fixture.meter.usage).toHaveLength(1)
			expect(fixture.control.failure).toBeUndefined()
		} finally {
			fixture.close()
		}
	})

	it('leaves an aborted ticket untouched and accounts its deadline once', async () => {
		const fixture = createStudyMeterFixture({
			request: { duration: 10, calls: 1, tokens: 10, bytes: 10 },
		})
		try {
			const ticket = fixture.meter.admit({ role: 'summary', tokens: 8, bytes: 8 })
			await waitForAbort(ticket.signal)
			expect(ticket.settled).toBe(true)
			failStudyTicket(ticket, new Error('Work escaped after the deadline'))
			expect(fixture.meter.usage).toMatchObject([
				{ role: 'summary', calls: 1, tokens: undefined, bytes: undefined },
			])
			expect(fixture.meter.usage).toHaveLength(1)
			expect(fixture.control.failure).toEqual({
				cause: 'deadline',
				message: 'Request deadline expired',
				role: 'summary',
				stop: { layer: 'scope', id: 'Request duration', max: 10, consumed: expect.any(Number) },
			})
		} finally {
			fixture.close()
		}
	})
})

describe('stop readings at admission and output', () => {
	it('reads only branded budget context members that attribution uses', () => {
		const error = new BudgetError({ id: 'owned', max: 1, consumed: 2 })
		Object.defineProperty(error, 'context', {
			value: Object.defineProperty({ id: 'owned', max: 1, consumed: 2 }, 'extra', {
				enumerable: true,
				get: () => {
					throw new Error('Unrelated budget member')
				},
			}),
		})
		expect(readStudyFailure(error).stop).toEqual({
			layer: 'budget',
			id: 'owned',
			max: 1,
			consumed: 2,
		})
	})
	it('reads branded budget context with a fallback id and unknown non-finite readings', () => {
		const error = new BudgetError({ id: '', max: NaN, consumed: Infinity })
		expect(readStudyFailure(error)).toEqual({
			cause: 'capacity',
			message: 'budget reached its ceiling',
			role: undefined,
			stop: { layer: 'budget', id: 'Agent budget', max: undefined, consumed: undefined },
		})
	})
	it('names admitted tokens before bytes and leaves unknown usage alone', () => {
		const charge = { role: 'agent', tokens: 4, bytes: 8 } as const
		const usage = { role: 'agent', calls: 1, tokens: 5, bytes: 9, duration: 0 } as const
		expect(computeStudyAdmittedStop(charge, usage)).toEqual({
			layer: 'scope',
			id: 'Admitted tokens',
			max: 4,
			consumed: 5,
		})
		expect(computeStudyAdmittedStop(charge, { ...usage, tokens: 4 })).toEqual({
			layer: 'scope',
			id: 'Admitted bytes',
			max: 8,
			consumed: 9,
		})
		expect(
			computeStudyAdmittedStop(charge, { ...usage, tokens: undefined, bytes: undefined }),
		).toBeUndefined()
	})

	it('names goal then trial then series output and includes already consumed bytes', () => {
		const trial = new Budget({ id: 'Trial output', max: 10, consumer: (bytes: number) => bytes })
		const series = new Budget({ id: 'Series output', max: 20, consumer: (bytes: number) => bytes })
		trial.consume(8)
		series.consume(19)
		expect(computeStudyOutputStop(4, 3, [trial, series])).toEqual({
			layer: 'scope',
			id: 'Goal bytes',
			max: 3,
			consumed: 4,
		})
		expect(computeStudyOutputStop(4, 4, [trial, series])).toEqual({
			layer: 'scope',
			id: 'Trial output',
			max: 10,
			consumed: 12,
		})
		expect(computeStudyOutputStop(2, 4, [trial, series])).toEqual({
			layer: 'scope',
			id: 'Series output',
			max: 20,
			consumed: 21,
		})
		expect(computeStudyOutputStop(1, 4, [trial, series])).toBeUndefined()
	})
})
