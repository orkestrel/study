import type { StudyUsage } from '../../../../src/core/types.js'
import type { StudyRemoteTicketOptions } from '../../../../src/server/processes/types.js'
import { createRecorder } from '@orkestrel/test'
import { describe, expect, it } from 'vitest'
import { failStudyTicket } from '../../../../src/core/engines/helpers.js'
import { StudyError } from '../../../../src/core/errors.js'
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
		expect(replacement.calls).toEqual([])
		selected.abort()
		expect(aborts.calls.map(([event]) => [event.type, event.target])).toEqual([
			['abort', selected.signal],
		])
		expect(ticket.signal.aborted).toBe(true)
		foreign.abort()
		expect(aborts.calls.map(([event]) => [event.type, event.target])).toEqual([
			['abort', selected.signal],
		])
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
		expect(replacement.calls).toEqual([])
	})

	it('derives settled from its own settlement and never from the signal', () => {
		const settle = createRecorder<Parameters<StudyRemoteTicketOptions['settle']>>()
		const controller = new AbortController()
		const ticket = new StudyRemoteTicket({
			id: 1,
			signal: controller.signal,
			settle: settle.handler,
		})
		expect(ticket.settled).toBe(false)
		controller.abort()
		expect(ticket.signal.aborted).toBe(true)
		expect(ticket.settled).toBe(false)
		ticket.finish({ role: 'tool', calls: 1, tokens: 1, bytes: 1, duration: 1 })
		expect(ticket.settled).toBe(true)
		const failed = new StudyRemoteTicket({
			id: 2,
			signal: new AbortController().signal,
			settle: settle.handler,
		})
		failed.fail({
			cause: 'infrastructure',
			message: 'Provider refused',
			role: 'tool',
			stop: undefined,
		})
		expect(failed.settled).toBe(true)
	})

	it('leaves an aborted ticket to its parent without settling it locally', () => {
		const settle = createRecorder<Parameters<StudyRemoteTicketOptions['settle']>>()
		const controller = new AbortController()
		const ticket = new StudyRemoteTicket({
			id: 1,
			signal: controller.signal,
			settle: settle.handler,
		})
		controller.abort()
		failStudyTicket(ticket, new Error('Work escaped after the parent aborted'))
		expect(settle.count).toBe(0)
		expect(ticket.settled).toBe(false)
		const usage = { role: 'tool', calls: 1, tokens: 1, bytes: 1, duration: 1 } satisfies StudyUsage
		ticket.finish(usage)
		expect(settle.calls).toEqual([['finish', usage]])
		expect(ticket.settled).toBe(true)
	})

	it('transmits one failure for a pending ticket and no second accounting', () => {
		const settle = createRecorder<Parameters<StudyRemoteTicketOptions['settle']>>()
		const ticket = new StudyRemoteTicket({
			id: 1,
			signal: new AbortController().signal,
			settle: settle.handler,
		})
		failStudyTicket(ticket, new StudyError('CAPACITY', 'No request room'))
		failStudyTicket(ticket, new Error('Cleanup also failed'))
		expect(settle.calls).toEqual([
			['fail', { cause: 'capacity', message: 'No request room', role: undefined }],
		])
		expect(ticket.settled).toBe(true)
	})

	it('transmits an explicit role over a carried one and nothing for an aborted ticket', () => {
		const settle = createRecorder<Parameters<StudyRemoteTicketOptions['settle']>>()
		const ticket = new StudyRemoteTicket({
			id: 1,
			signal: new AbortController().signal,
			settle: settle.handler,
		})
		const foreign = new StudyError('FAULT', 'Judge refused', {
			cause: 'infrastructure',
			message: 'Judge refused',
			role: 'judge',
			stop: undefined,
		})
		failStudyTicket(ticket, foreign, 'tool')
		expect(settle.calls).toEqual([
			['fail', { cause: 'infrastructure', message: 'Judge refused', role: 'tool' }],
		])
		const controller = new AbortController()
		const aborted = new StudyRemoteTicket({
			id: 2,
			signal: controller.signal,
			settle: settle.handler,
		})
		controller.abort()
		failStudyTicket(aborted, foreign, 'tool')
		expect(settle.count).toBe(1)
	})

	it('leaves a finished ticket untouched', () => {
		const settle = createRecorder<Parameters<StudyRemoteTicketOptions['settle']>>()
		const ticket = new StudyRemoteTicket({
			id: 1,
			signal: new AbortController().signal,
			settle: settle.handler,
		})
		const usage = { role: 'tool', calls: 1, tokens: 1, bytes: 1, duration: 1 } satisfies StudyUsage
		ticket.finish(usage)
		failStudyTicket(ticket, new Error('Late failure'))
		expect(settle.calls).toEqual([['finish', usage]])
	})

	it('propagates a refused settlement once and accounts nothing afterwards', () => {
		const refusal = new StudyError('FAULT', 'Parent refused the settlement')
		const attempts = createRecorder<Parameters<StudyRemoteTicketOptions['settle']>>()
		const ticket = new StudyRemoteTicket({
			id: 1,
			signal: new AbortController().signal,
			settle: (operation, value) => {
				attempts.handler(operation, value)
				throw refusal
			},
		})
		expect(() => failStudyTicket(ticket, new Error('Provider refused'))).toThrow(refusal)
		expect(ticket.settled).toBe(true)
		failStudyTicket(ticket, new Error('Cleanup also failed'))
		expect(attempts.calls).toEqual([
			['fail', { cause: 'infrastructure', message: 'Provider refused', role: undefined }],
		])
	})
})
