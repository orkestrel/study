import { expect, it } from 'vitest'
import { STUDY_ERROR_BRAND } from '../../../src/core/constants.js'
import { isStudyError, StudyError } from '../../../src/core/errors.js'
import { importStudyErrorCopy } from '../../setupStudy.js'

const BRAND = Symbol.for('@orkestrel/study.error')

it('retains coded failure attribution and safely narrows caught values', () => {
	const failure = {
		cause: 'capacity',
		message: 'Context full',
		role: 'agent',
		stop: undefined,
	} as const
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

it('stamps a nonenumerable global self-brand without changing the public properties', () => {
	expect(STUDY_ERROR_BRAND).toBe(BRAND)
	const error = new StudyError('FAULT', 'Adapter crashed')
	expect(Object.getOwnPropertyDescriptor(error, BRAND)).toMatchObject({
		value: error,
		enumerable: false,
	})
	expect(Object.keys(error).sort()).toEqual(['code', 'failure', 'name'])
	expect(JSON.parse(JSON.stringify(error))).toEqual({ name: 'StudyError', code: 'FAULT' })
})

it('recognizes study errors across distinct evaluated module copies', async () => {
	const copy = await importStudyErrorCopy('errors-recognition')
	expect(copy.error).not.toBe(StudyError)
	const foreign = copy.create('CAPACITY', 'Copy refusal')
	expect(foreign).not.toBeInstanceOf(StudyError)
	expect(isStudyError(foreign)).toBe(true)
	expect(copy.recognize(new StudyError('DEADLINE', 'Local refusal'))).toBe(true)
})

it('refuses lookalikes, inherited or borrowed brands, and malformed codes', () => {
	const real = new StudyError('CAPACITY', 'Real refusal')
	const foreign = Object.assign(new Error('Foreign'), { name: 'StudyError', code: 'CAPACITY' })
	expect(isStudyError(foreign)).toBe(false)
	const copied = Object.assign(new Error('Copied'), { name: 'StudyError', code: 'CAPACITY' })
	Object.defineProperty(copied, BRAND, { value: copied })
	expect(isStudyError(copied)).toBe(false)
	const plain = { name: 'StudyError', code: 'CAPACITY', message: 'Plain' }
	Object.defineProperty(plain, BRAND, { value: plain })
	expect(isStudyError(plain)).toBe(false)
	expect(isStudyError(Object.create(real))).toBe(false)
	const borrowed = new StudyError('CAPACITY', 'Borrowed')
	Object.defineProperty(borrowed, BRAND, { value: real })
	expect(isStudyError(borrowed)).toBe(false)
	const malformed = new StudyError('CONFIG', 'Malformed')
	Object.defineProperty(malformed, 'code', { value: 'ARTIFACT' })
	expect(isStudyError(malformed)).toBe(false)
	const renamed = new StudyError('CONFIG', 'Renamed')
	Object.defineProperty(renamed, 'name', { value: 'Error' })
	expect(isStudyError(renamed)).toBe(false)
	expect(isStudyError(real)).toBe(true)
})

it('refuses proxies and hostile property access without throwing', () => {
	const real = new StudyError('DEADLINE', 'Real deadline')
	expect(isStudyError(new Proxy(real, {}))).toBe(false)
	const revocable = Proxy.revocable(real, {})
	revocable.revoke()
	expect(isStudyError(revocable.proxy)).toBe(false)
	expect(
		isStudyError(
			new Proxy(real, {
				getOwnPropertyDescriptor: () => {
					throw new Error('descriptor')
				},
			}),
		),
	).toBe(false)
	expect(
		isStudyError(
			new Proxy(real, {
				get: () => {
					throw new Error('get')
				},
			}),
		),
	).toBe(false)
	const hostile = new StudyError('DEADLINE', 'Hostile')
	Object.defineProperty(hostile, 'name', {
		get: () => {
			throw new Error('name')
		},
	})
	expect(isStudyError(hostile)).toBe(false)
	const coded = new StudyError('DEADLINE', 'Hostile code')
	Object.defineProperty(coded, 'code', {
		get: () => {
			throw new Error('code')
		},
	})
	expect(isStudyError(coded)).toBe(false)
	expect(isStudyError(real)).toBe(true)
})
