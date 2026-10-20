import type { StudyFailure, StudyStop } from '../../../src/core/types.js'
import { isRecord } from '@orkestrel/contract'
import { requireValue } from '@orkestrel/test'
import { createScratch } from '@orkestrel/test/server'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import { STUDY_ERROR_BRAND } from '../../../src/core/constants.js'
import { isStudyError, StudyError } from '../../../src/core/errors.js'
import { importStudyErrorCopy } from '../../setupStudy.js'
import { buildStudyLibrary } from '../../setupServer.js'

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
		writable: false,
	})
	expect(Object.keys(error).sort()).toEqual(['code', 'failure', 'name'])
	expect(JSON.parse(JSON.stringify(error))).toEqual({ name: 'StudyError', code: 'FAULT' })
})

it('crosses guards from built error copies at distinct scratch paths', async () => {
	const scratch = createScratch({ parent: resolve('tmp'), prefix: 'study-error-guard-' })
	try {
		await buildStudyLibrary(scratch, resolve('src/core/errors.ts'))
		const source = requireValue(scratch.read('library/dist/index.js'))
		const first: unknown = await import(pathToFileURL(scratch.write('first.mjs', source)).href)
		const second: unknown = await import(pathToFileURL(scratch.write('second.mjs', source)).href)
		if (
			!isRecord(first) ||
			!isRecord(second) ||
			typeof first.StudyError !== 'function' ||
			typeof second.StudyError !== 'function' ||
			typeof first.isStudyError !== 'function' ||
			typeof second.isStudyError !== 'function'
		)
			throw new Error('Built error copies must export their class and guard')
		expect(first.StudyError).not.toBe(second.StudyError)
		expect(first.StudyError).not.toBe(StudyError)
		expect(second.StudyError).not.toBe(StudyError)
		const failure = { cause: 'deadline', message: 'Expired', role: 'agent', stop: undefined }
		const firstError: unknown = Reflect.construct(first.StudyError, ['DEADLINE', 'First', failure])
		const secondError: unknown = Reflect.construct(second.StudyError, [
			'DEADLINE',
			'Second',
			failure,
		])
		expect(Reflect.apply(first.isStudyError, undefined, [secondError])).toBe(true)
		expect(Reflect.apply(second.isStudyError, undefined, [firstError])).toBe(true)
		expect(isStudyError(firstError)).toBe(true)
		expect(isStudyError(secondError)).toBe(true)
	} finally {
		scratch.destroy()
	}
})

it('recognizes subclass instances with their own names and self-brands', () => {
	class DerivedStudyError extends StudyError {
		constructor() {
			super('CONFIG', 'Subclass refusal')
			this.name = 'DerivedStudyError'
		}
	}
	const error = new DerivedStudyError()
	expect(Object.getOwnPropertyDescriptor(error, BRAND)?.value).toBe(error)
	expect(isStudyError(error)).toBe(true)
})

it('recognizes a typed class stop without imposing serialized record shape', () => {
	class Ceiling implements StudyStop {
		readonly layer = 'model'
		readonly id = 'num_predict'
		readonly max = 100
		readonly consumed = 101
	}
	const failure: StudyFailure = {
		cause: 'capacity',
		message: 'Reached',
		role: 'agent',
		stop: new Ceiling(),
	}
	expect(isStudyError(new StudyError('CAPACITY', 'Class stop', failure))).toBe(true)
	const extended: StudyFailure = {
		...failure,
		stop: Object.assign(new Ceiling(), { id: '', extra: true }),
	}
	expect(isStudyError(new StudyError('CAPACITY', 'Structural stop', extended))).toBe(true)
})

it('uses captured reflection for nested stop members', () => {
	const error = new StudyError('CAPACITY', 'Captured stop', {
		cause: 'capacity',
		message: 'Reached',
		role: 'agent',
		stop: { layer: 'model', id: 'num_predict', max: 100, consumed: 101 },
	})
	const descriptor = requireValue(Object.getOwnPropertyDescriptor(Reflect, 'ownKeys'))
	expect(isStudyError(error)).toBe(true)
	try {
		Object.defineProperty(Reflect, 'ownKeys', {
			value: () => {
				throw new Error('Ambient reflection must not inspect a stop')
			},
		})
		expect(isStudyError(error)).toBe(true)
	} finally {
		Object.defineProperty(Reflect, 'ownKeys', descriptor)
	}
	expect(Object.getOwnPropertyDescriptor(Reflect, 'ownKeys')).toEqual(descriptor)
	expect(isStudyError(error)).toBe(true)
})

it('refuses malformed stop fields and hostile nested access', () => {
	const failure: StudyFailure = {
		cause: 'capacity',
		message: 'Reached',
		role: 'agent',
		stop: undefined,
	}
	const error = new StudyError('CAPACITY', 'Invalid stop', failure)
	Object.defineProperty(failure, 'stop', { value: 7 })
	expect(isStudyError(error)).toBe(false)
	Object.defineProperty(failure, 'stop', {
		value: { layer: 'unknown', id: 'num_predict', max: 100, consumed: 101 },
	})
	expect(isStudyError(error)).toBe(false)
	Object.defineProperty(failure, 'stop', {
		value: { layer: 'model', id: 7, max: 100, consumed: 101 },
	})
	expect(isStudyError(error)).toBe(false)
	Object.defineProperty(failure, 'stop', {
		value: { layer: 'model', id: 'num_predict', max: Infinity, consumed: 101 },
	})
	expect(isStudyError(error)).toBe(false)
	Object.defineProperty(failure, 'stop', {
		value: { layer: 'model', id: 'num_predict', max: 100, consumed: NaN },
	})
	expect(isStudyError(error)).toBe(false)
	Object.defineProperty(failure, 'stop', {
		value: { layer: 'model', id: 'num_predict', max: '100', consumed: 101 },
	})
	expect(isStudyError(error)).toBe(false)
	Object.defineProperty(failure, 'stop', {
		value: { layer: 'model', id: 'num_predict', max: 100, consumed: '101' },
	})
	expect(isStudyError(error)).toBe(false)
	Object.defineProperty(failure, 'stop', {
		value: {
			get layer() {
				throw new Error('Hostile stop')
			},
		},
	})
	expect(isStudyError(error)).toBe(false)
	const revocable = Proxy.revocable({}, {})
	revocable.revoke()
	Object.defineProperty(failure, 'stop', { value: revocable.proxy })
	expect(isStudyError(error)).toBe(false)
	Object.defineProperty(failure, 'stop', {
		value: { layer: 'model', id: 'num_predict', max: undefined, consumed: -0.5 },
	})
	expect(isStudyError(error)).toBe(true)
	Object.defineProperty(failure, 'stop', {
		value: { layer: 'model', id: 'num_predict', max: -0, consumed: undefined },
	})
	expect(isStudyError(error)).toBe(true)
})

it('refuses malformed failure members on an otherwise valid error', () => {
	const error = new StudyError('FAULT', 'Malformed attribution')
	Object.defineProperty(error, 'failure', { value: 7 })
	expect(isStudyError(error)).toBe(false)
	Object.defineProperty(error, 'failure', { value: { cause: 'content', message: 7 } })
	expect(isStudyError(error)).toBe(false)
	Object.defineProperty(error, 'failure', { value: { cause: 'unknown', message: 'Failure' } })
	expect(isStudyError(error)).toBe(false)
	Object.defineProperty(error, 'failure', {
		value: { cause: 'content', message: 'Failure', role: 'unknown' },
	})
	expect(isStudyError(error)).toBe(false)
	Object.defineProperty(error, 'failure', {
		value: { cause: 'capacity', message: 'Failure', stop: { layer: 'unknown' } },
	})
	expect(isStudyError(error)).toBe(false)
	Object.defineProperty(error, 'failure', {
		value: {
			cause: 'capacity',
			message: 'Failure',
			role: 'agent',
			stop: { layer: 'model', id: 'num_predict', max: -0.5, consumed: 1 },
		},
	})
	expect(isStudyError(error)).toBe(true)
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
	const plain = {}
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
	expect(isStudyError(renamed)).toBe(true)
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
