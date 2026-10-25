import type { StudyUsage } from '../../../../src/core/types.js'
import { createScratch, isRunning } from '@orkestrel/test/server'
import { createTeardown, requireValue } from '@orkestrel/test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { StudyControl } from '../../../../src/core/engines/StudyControl.js'
import { StudyDeadline } from '../../../../src/core/engines/StudyDeadline.js'
import { failStudyTicket } from '../../../../src/core/engines/helpers.js'
import { STUDY_PROCESS_LABEL } from '../../../../src/server/processes/constants.js'
import { StudyChannel } from '../../../../src/server/processes/StudyChannel.js'
import { StudyRemoteMeter } from '../../../../src/server/processes/StudyRemoteMeter.js'
import {
	createStudyPeer,
	createStudyAccountingPeer,
	createOllamaDiskFixture,
	createOllamaTransportProvider,
} from '../../../setupServer.js'
import { readSettled, STUDY_AGENT_MESSAGES, STUDY_OLLAMA_PARTIAL_ROW } from '../../../setupStudy.js'
import { readStudyExchangeRows } from '../../../../src/server/stores/helpers.js'

describe('StudyRemoteMeter', () => {
	it('joins recorded native abandonment with singular accounting over real IPC', async () => {
		const teardown = createTeardown()
		const scratch = createScratch()
		teardown.add(() => scratch.destroy())
		const peer = await createStudyAccountingPeer(scratch)
		teardown.add(() => peer.close())
		const pid = requireValue(peer.child.pid)
		const channel = new StudyChannel({
			endpoint: peer.child,
			handle: async () => {
				throw new Error('Accounting peer requested worker work')
			},
			abort: () => {
				throw new Error('Unexpected accounting cancellation')
			},
		})
		teardown.add(() => channel.close())
		const control = new StudyControl()
		teardown.add(() => control.close())
		const meter = new StudyRemoteMeter({ channel, control })
		try {
			const fixture = await createOllamaDiskFixture(true, [
				{ path: '/api/chat', body: STUDY_OLLAMA_PARTIAL_ROW, open: true },
			])
			teardown.add(() => fixture.close())
			fixture.transport.clear()
			fixture.transport.prepare({
				goal: 'first',
				checkpoint: undefined,
				context: { ...fixture.goal.context, signal: control.signal, meter },
			})
			await fixture.transport.verify()
			const provider = createOllamaTransportProvider(fixture.transport, fixture.server.url)
			const stream = provider.stream(STUDY_AGENT_MESSAGES, control.signal)
			expect(await stream.next()).toEqual({
				done: false,
				value: { channel: 'content', text: 'par' },
			})
			await stream.return({ content: '' })
			expect(control.signal.aborted).toBe(true)
			await expect(meter.close()).rejects.toMatchObject({
				message: 'Ollama response cancelled before its end',
			})
			expect(await channel.request('evidence', null)).toMatchObject({
				operations: ['admit', 'fail'],
				pending: 0,
				usage: [{ role: 'agent', calls: 1, tokens: null, bytes: null }],
				failure: { message: 'Ollama response cancelled before its end', role: 'agent' },
			})
			expect(meter.usage).toEqual([])
			await expect(
				provider.generate(STUDY_AGENT_MESSAGES, new AbortController().signal),
			).rejects.toThrow('cancelled before its end')
			expect(
				fixture.server.requests.filter((request) => request.path === '/api/chat'),
			).toHaveLength(1)
			await fixture.transport.close()
			await fixture.sink?.close()
			const rows = readStudyExchangeRows(readFileSync(fixture.path), false)
			expect(
				rows.filter((row) => row.phase === 'attempt' && row.stage === 'execution'),
			).toHaveLength(1)
			expect(
				rows.filter((row) => row.phase === 'failure' && row.stage === 'execution'),
			).toMatchObject([
				{
					ordinal: 5,
					role: 'agent',
					response: { body: Buffer.from(STUDY_OLLAMA_PARTIAL_ROW).toString('base64') },
				},
			])
			expect(
				rows.some(
					(row) =>
						(row.phase === 'response' && row.stage === 'execution') || row.phase === 'complete',
				),
			).toBe(false)
		} finally {
			await teardown.destroy()
		}
		expect(isRunning(pid)).toBe(false)
		expect(existsSync(scratch.path)).toBe(false)
	}, 10000)

	it('waits for a real IPC admission grant and settlement acknowledgment before completion', async () => {
		const scratch = createScratch()
		const peer = createStudyPeer(
			scratch,
			`process.on('message', frame => setTimeout(() => process.send({id:frame.id,operation:'reply',value:frame.operation === 'admit' ? {id:frame.value.id} : true}),25))`,
		)
		const channel = new StudyChannel({
			endpoint: peer.child,
			handle: async () => true,
			abort: () => undefined,
		})
		const control = new StudyControl()
		const meter = new StudyRemoteMeter({ channel, control })
		const deadline = new StudyDeadline({ duration: 1000, label: STUDY_PROCESS_LABEL })
		try {
			const pending = meter.admit({ role: 'tool', tokens: 1, bytes: 1 })
			expect(await readSettled(pending)).toBe(false)
			const ticket = await deadline.wait(pending)
			expect(await readSettled(pending)).toBe(true)
			ticket.finish({ role: 'tool', calls: 1, tokens: 1, bytes: 1, duration: 1 })
			expect(meter.usage).toEqual([])
			await deadline.wait(meter.close())
			expect(meter.usage).toEqual([{ role: 'tool', calls: 1, tokens: 1, bytes: 1, duration: 1 }])
			expect(() =>
				ticket.finish({ role: 'tool', calls: 1, tokens: 1, bytes: 1, duration: 1 }),
			).toThrow(/settlement/)
			expect(control.failure?.cause).toBe('infrastructure')
		} finally {
			channel.close()
			control.close()
			await peer.close()
			scratch.destroy()
		}
	})

	it('keeps its selected channel and control after the caller replaces the options', async () => {
		const source = `const fs = require('node:fs'), path = require('node:path')
process.on('message', frame => {
	fs.appendFileSync(path.join(__dirname, 'receipt.log'), frame.operation + '\\n')
	process.send({id:frame.id,operation:'reply',value:frame.operation === 'admit' ? {id:frame.value.id} : true})
})`
		const firstScratch = createScratch()
		const secondScratch = createScratch()
		const first = createStudyPeer(firstScratch, source)
		const second = createStudyPeer(secondScratch, source)
		const firstChannel = new StudyChannel({
			endpoint: first.child,
			handle: async () => true,
			abort: () => undefined,
		})
		const secondChannel = new StudyChannel({
			endpoint: second.child,
			handle: async () => true,
			abort: () => undefined,
		})
		const firstControl = new StudyControl()
		const secondControl = new StudyControl()
		const options = { channel: firstChannel, control: firstControl }
		const meter = new StudyRemoteMeter(options)
		const deadline = new StudyDeadline({ duration: 2000, label: STUDY_PROCESS_LABEL })
		try {
			options.channel = secondChannel
			options.control = secondControl
			secondControl.fail({
				cause: 'interrupted',
				message: 'replacement aborted',
				role: undefined,
				stop: undefined,
			})
			expect(meter.signal).toBe(firstControl.signal)
			const ticket = await deadline.wait(meter.admit({ role: 'tool', tokens: 1, bytes: 1 }))
			expect(ticket.signal.aborted).toBe(false)
			ticket.finish({ role: 'tool', calls: 1, tokens: 1, bytes: 1, duration: 1 })
			await deadline.wait(meter.close())
			expect(meter.usage).toEqual([{ role: 'tool', calls: 1, tokens: 1, bytes: 1, duration: 1 }])
			expect(firstControl.failure).toBeUndefined()
			expect(readFileSync(join(firstScratch.path, 'receipt.log'), 'utf8')).toBe('admit\nfinish\n')
			expect(existsSync(join(secondScratch.path, 'receipt.log'))).toBe(false)
		} finally {
			firstChannel.close()
			secondChannel.close()
			firstControl.close()
			secondControl.close()
			await Promise.allSettled([first.close(), second.close()])
			firstScratch.destroy()
			secondScratch.destroy()
		}
	}, 15000)

	it('retains the settlement bytes it sent after the caller mutates the usage', async () => {
		const scratch = createScratch()
		const peer = createStudyPeer(
			scratch,
			`const fs = require('node:fs'), path = require('node:path')
process.on('message', frame => {
	if (frame.operation === 'admit') { process.send({id:frame.id,operation:'reply',value:{id:frame.value.id}}); return }
	setTimeout(() => {
		fs.writeFileSync(path.join(__dirname, 'receipt.json'), JSON.stringify(frame.value.usage))
		process.send({id:frame.id,operation:'reply',value:true})
	}, 25)
})`,
		)
		const channel = new StudyChannel({
			endpoint: peer.child,
			handle: async () => true,
			abort: () => undefined,
		})
		const control = new StudyControl()
		const meter = new StudyRemoteMeter({ channel, control })
		const deadline = new StudyDeadline({ duration: 2000, label: STUDY_PROCESS_LABEL })
		try {
			const ticket = await deadline.wait(meter.admit({ role: 'tool', tokens: 1, bytes: 1 }))
			const usage = {
				role: 'tool',
				calls: 1,
				tokens: 3,
				bytes: 5,
				duration: 7,
			} satisfies StudyUsage
			ticket.finish(usage)
			usage.tokens = 99
			expect(meter.usage).toEqual([])
			await deadline.wait(meter.close())
			const original = { role: 'tool', calls: 1, tokens: 3, bytes: 5, duration: 7 }
			expect(meter.usage).toEqual([original])
			expect(JSON.parse(readFileSync(join(scratch.path, 'receipt.json'), 'utf8'))).toEqual(original)
		} finally {
			channel.close()
			control.close()
			await peer.close()
			scratch.destroy()
		}
	}, 15000)

	it('leaves a parent-aborted ticket to the parent without local settlement or a second accounting', async () => {
		const scratch = createScratch()
		const peer = createStudyPeer(
			scratch,
			`const fs = require('node:fs'), path = require('node:path')
process.on('message', frame => {
	fs.appendFileSync(path.join(__dirname, 'receipt.log'), frame.operation + '\\n')
	process.send({id:frame.id,operation:'reply',value:frame.operation === 'admit' ? {id:frame.value.id} : true})
})`,
		)
		const channel = new StudyChannel({
			endpoint: peer.child,
			handle: async () => true,
			abort: () => undefined,
		})
		const control = new StudyControl()
		const meter = new StudyRemoteMeter({ channel, control })
		const deadline = new StudyDeadline({ duration: 2000, label: STUDY_PROCESS_LABEL })
		try {
			const ticket = await deadline.wait(meter.admit({ role: 'tool', tokens: 1, bytes: 1 }))
			const failure = {
				cause: 'deadline',
				message: 'Parent deadline expired',
				role: 'tool',
				stop: undefined,
			} as const
			meter.abort(1, failure)
			expect(ticket.signal.aborted).toBe(true)
			expect(ticket.settled).toBe(false)
			failStudyTicket(ticket, new Error('Work escaped after the parent aborted'))
			expect(ticket.settled).toBe(false)
			expect(control.failure).toEqual(failure)
			await expect(deadline.wait(meter.close())).rejects.toMatchObject({ failure })
			expect(meter.usage).toEqual([])
			expect(readFileSync(join(scratch.path, 'receipt.log'), 'utf8')).toBe('admit\n')
		} finally {
			channel.close()
			control.close()
			await peer.close()
			scratch.destroy()
		}
	}, 15000)

	it('keeps denied admission sticky even when its rejection is caught', async () => {
		const scratch = createScratch()
		const peer = createStudyPeer(
			scratch,
			`process.on('message', frame => process.send({id:frame.id,operation:'error',value:{cause:'capacity',message:'parent denied',role:'tool'}}))`,
		)
		const channel = new StudyChannel({
			endpoint: peer.child,
			handle: async () => true,
			abort: () => undefined,
		})
		const control = new StudyControl()
		const meter = new StudyRemoteMeter({ channel, control })
		try {
			await expect(
				new StudyDeadline({ duration: 1000, label: STUDY_PROCESS_LABEL }).wait(
					meter.admit({ role: 'tool', tokens: 1, bytes: 1 }),
				),
			).rejects.toThrow(/parent denied/)
			await expect(meter.admit({ role: 'tool', tokens: 0, bytes: 0 })).rejects.toThrow(
				/parent denied/,
			)
			await expect(meter.close()).rejects.toMatchObject({ failure: { cause: 'capacity' } })
			expect(meter.usage).toEqual([])
		} finally {
			channel.close()
			control.close()
			await peer.close()
			scratch.destroy()
		}
	})
})
