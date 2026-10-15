import type { StudyUsage } from '../../../../src/core/types.js'
import type { StudyRemoteTicketOptions } from '../../../../src/server/processes/types.js'
import { createRecorder } from '@orkestrel/test'
import { describe, expect, it } from 'vitest'
import { StudyRemoteTicket } from '../../../../src/server/processes/StudyRemoteTicket.js'

describe('StudyRemoteTicket', () => {
	it('keeps its selected signal and settlement callback after the caller replaces the options', () => {
		const original = createRecorder<Parameters<StudyRemoteTicketOptions['settle']>>()
		const replacement = createRecorder<Parameters<StudyRemoteTicketOptions['settle']>>()
		const selected = new AbortController()
		const foreign = new AbortController()
		const options = { id: 1, signal: selected.signal, settle: original.handler }
		const ticket = new StudyRemoteTicket(options)
		options.signal = foreign.signal
		options.settle = replacement.handler
		const aborts = createRecorder<readonly [Event]>()
		ticket.signal.addEventListener('abort', aborts.handler)
		expect(ticket.signal).toBe(selected.signal)
		const usage = {
			role: 'tool',
			calls: 1,
			tokens: 1,
			bytes: 1,
			duration: 1,
		} satisfies StudyUsage
		ticket.finish(usage)
		expect(original.calls).toEqual([['finish', usage]])
		expect(replacement.count).toBe(0)
		selected.abort()
		expect(aborts.count).toBe(1)
		expect(ticket.signal.aborted).toBe(true)
		foreign.abort()
		expect(aborts.count).toBe(1)
		expect(() => ticket.finish(usage)).toThrow(/settled more than once/)
		expect(original.calls).toEqual([
			['finish', usage],
			[
				'fail',
				{
					cause: 'infrastructure',
					message: 'Worker ticket settled more than once',
					role: undefined,
				},
			],
		])
		expect(replacement.count).toBe(0)
	})
})
