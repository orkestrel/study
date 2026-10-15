import type { StudyFailure } from '../../../../src/core/types.js'
import { describe, expect, it } from 'vitest'
import { StudyError } from '../../../../src/core/errors.js'
import { failureToStudyError, readStudyFailure } from '../../../../src/core/engines/helpers.js'
import { importStudyErrorCopy } from '../../../setupStudy.js'

describe('study engine error attribution', () => {
	it('preserves an existing operational reading and classifies uncategorized errors', () => {
		const failure = { cause: 'capacity', message: 'No request room', role: 'agent' } as const
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
		const failure: StudyFailure = { cause: 'interrupted', message: 'Series stopped', role: 'agent' }
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
		const failure: StudyFailure = { cause: 'capacity', message: 'Context full', role: 'agent' }
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
