import { createScratch } from '@orkestrel/test/server'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { StudyControl } from '../../../../src/core/engines/StudyControl.js'
import { StudyDeadline } from '../../../../src/core/engines/StudyDeadline.js'
import { STUDY_PROCESS_LABEL } from '../../../../src/server/processes/constants.js'
import { StudyChannel } from '../../../../src/server/processes/StudyChannel.js'
import { StudyRemoteMeter } from '../../../../src/server/processes/StudyRemoteMeter.js'
import { createStudyPeer } from '../../../setupServer.js'

describe('StudyRemoteMeter', () => {
	it('waits for a real IPC admission grant and settlement acknowledgment before completion', async () => {
		const scratch = createScratch()
		const peer = createStudyPeer(
			scratch,
			`process.on('message', frame => setTimeout(() => process.send({version:1,id:frame.id,operation:'reply',value:frame.operation === 'admit' ? {id:frame.value.id} : true}),25))`,
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
			let admitted = false
			const pending = meter.admit({ role: 'tool', tokens: 1, bytes: 1 }).then((ticket) => {
				admitted = true
				return ticket
			})
			await Promise.resolve()
			expect(admitted).toBe(false)
			const ticket = await deadline.wait(pending)
			expect(admitted).toBe(true)
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
	process.send({version:1,id:frame.id,operation:'reply',value:frame.operation === 'admit' ? {id:frame.value.id} : true})
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
			secondControl.fail({ cause: 'interrupted', message: 'replacement aborted', role: undefined })
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
	if (frame.operation === 'admit') { process.send({version:1,id:frame.id,operation:'reply',value:{id:frame.value.id}}); return }
	setTimeout(() => {
		fs.writeFileSync(path.join(__dirname, 'receipt.json'), JSON.stringify(frame.value.usage))
		process.send({version:1,id:frame.id,operation:'reply',value:true})
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
			const usage: { role: 'tool'; calls: number; tokens: number; bytes: number; duration: number } =
				{ role: 'tool', calls: 1, tokens: 3, bytes: 5, duration: 7 }
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

	it('keeps denied admission sticky even when its rejection is caught', async () => {
		const scratch = createScratch()
		const peer = createStudyPeer(
			scratch,
			`process.on('message', frame => process.send({version:1,id:frame.id,operation:'error',value:{cause:'capacity',message:'parent denied',role:'tool'}}))`,
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
