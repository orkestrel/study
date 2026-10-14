import { expect, it } from 'vitest'
import { isStudyError, StudyError } from '../../../src/core/errors.js'

it('retains coded failure attribution and safely narrows caught values', () => {
	const failure = { cause: 'capacity', message: 'Context full', role: 'agent' } as const
	const error = new StudyError('CAPACITY', 'Request cannot fit', failure)
	expect(error.message).toBe('Request cannot fit')
	expect(error.code).toBe('CAPACITY')
	expect(error.failure).toBe(failure)
	expect(error.name).toBe('StudyError')
	expect(isStudyError(error)).toBe(true)
	expect(isStudyError(new Error('ordinary'))).toBe(false)
	expect(isStudyError({ code: 'CAPACITY' })).toBe(false)
	expect(isStudyError(undefined)).toBe(false)
	expect(
		isStudyError(
			new Proxy(
				{},
				{
					getPrototypeOf: () => {
						throw new Error('prototype')
					},
				},
			),
		),
	).toBe(false)
})
