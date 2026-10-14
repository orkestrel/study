import { createScratch } from '@orkestrel/test/server'
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
