import * as entry from '@src/core'
import { describe, expect, it } from 'vitest'

describe('src core entry', () => {
	it('exposes usable study failures and admission controls through the package entry', () => {
		const control = new entry.StudyControl()
		try {
			control.fail({ cause: 'capacity', message: 'Consumer allowance exhausted', role: 'tool' })
			expect(control.signal.aborted).toBe(true)
			const error = entry.failureToStudyError(
				control.failure ?? { cause: 'infrastructure', message: 'Missing failure', role: undefined },
			)
			expect(entry.isStudyError(error)).toBe(true)
			expect(error.code).toBe('CAPACITY')
		} finally {
			control.close()
		}
	})

	it('exposes ticket failure settlement through the package entry', () => {
		expect(entry.failStudyTicket).toBeTypeOf('function')
	})

	it('exposes the shared bounded wait and product guard through the package entry', async () => {
		const deadline = new entry.StudyDeadline({ duration: 1000, label: 'Custody or cleanup' })
		expect(await deadline.wait(Promise.resolve('closed'))).toBe('closed')
		expect(entry.isStudyProduct({ value: 'closed', partial: false })).toBe(true)
	})
})
