import { describe, expect, it } from 'vitest'
import { StudyError } from '../../../../src/core/errors.js'
import { failureToStudyError, readStudyFailure } from '../../../../src/core/engines/helpers.js'

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
})
