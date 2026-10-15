import { isRecord } from '@orkestrel/contract'
import { createRecorder, waitForAbort, waitForCondition, waitForEvent } from '@orkestrel/test'
import { createScratch } from '@orkestrel/test/server'
import { describe, expect, it } from 'vitest'
import { StudyChannel } from '../../../../src/server/processes/StudyChannel.js'
import {
	STUDY_PENDING_LIMIT,
	STUDY_PROCESS_LABEL,
} from '../../../../src/server/processes/constants.js'
import { readStudyFailure } from '../../../../src/core/engines/helpers.js'
import { StudyDeadline } from '../../../../src/core/engines/StudyDeadline.js'
import { createStudyPeer } from '../../../setupServer.js'

describe('StudyChannel', () => {
	it('correlates real child replies and rejects malformed, foreign, oversized and premature endings', async () => {
		for (const action of ['echo', 'malformed', 'foreign', 'failure', 'oversized', 'exit']) {
			const scratch = createScratch()
			const peer = createStudyPeer(
				scratch,
				`process.on('message', frame => {
				const action = ${JSON.stringify(action)}
				if (action === 'exit') { process.exit(7); return }
				if (action === 'malformed') { process.send({invalid:true}); return }
				if (action === 'failure') { process.send({id:frame.id,operation:'error',value:{invalid:true}}); return }
				if (action === 'oversized') { process.send({id:frame.id,operation:'reply',value:'x'.repeat(16*1024*1024)}); return }
				process.send({id:action === 'foreign' ? frame.id+1 : frame.id,operation:'reply',value:frame.value})
			})`,
			)
			const channel = new StudyChannel({
				endpoint: peer.child,
				handle: async () => true,
				abort: () => undefined,
			})
			try {
				const response = new StudyDeadline({ duration: 2000, label: STUDY_PROCESS_LABEL }).wait(
					channel.request('goal', { public: 'input' }),
				)
				const outcome = await response.then(
					(value) => ({ value }),
					(error: unknown) => ({ failure: readStudyFailure(error).cause }),
				)
				expect(outcome).toEqual(
					action === 'echo' ? { value: { public: 'input' } } : { failure: 'infrastructure' },
				)
			} finally {
				channel.close()
				await peer.close()
				expect(peer.child.listenerCount('message')).toBe(0)
				scratch.destroy()
			}
		}
	}, 15000)

	it('refuses nonsequential requests before invoking the domain handler', async () => {
		const scratch = createScratch()
		const peer = createStudyPeer(
			scratch,
			`process.send({id:2,operation:'admit',value:{}}); process.on('message',()=>{})`,
		)
		const operations: string[] = []
		const channel = new StudyChannel({
			endpoint: peer.child,
			handle: async (operation) => {
				operations.push(operation)
				return true
			},
			abort: () => undefined,
		})
		try {
			await new StudyDeadline({ duration: 2000, label: STUDY_PROCESS_LABEL }).wait(
				new Promise<void>((resolve) =>
					channel.signal.addEventListener('abort', () => resolve(), { once: true }),
				),
			)
			expect(operations).toEqual([])
			expect(channel.signal.reason).toMatchObject({
				failure: {
					cause: 'infrastructure',
					message: 'Out-of-order or excessive study IPC request',
				},
			})
		} finally {
			channel.close()
			await peer.close()
			scratch.destroy()
		}
	})

	it('keeps its selected endpoint and handlers after the caller replaces the options', async () => {
		const firstScratch = createScratch()
		const secondScratch = createScratch()
		const first = createStudyPeer(
			firstScratch,
			`process.on('message', frame => {
				if (frame.operation !== 'goal') return
				process.send({id:1,operation:'admit',value:{}})
				process.send({id:frame.id,operation:'reply',value:'original'})
			})`,
		)
		const second = createStudyPeer(
			secondScratch,
			`process.on('message', frame => {
				if (frame.operation !== 'goal') return
				process.send({id:1,operation:'admit',value:{}})
				process.send({id:frame.id,operation:'reply',value:'replacement'})
			})`,
		)
		const original = createRecorder<readonly [string]>()
		const replacement = createRecorder<readonly [string]>()
		const options = {
			endpoint: first.child,
			handle: async (operation: string) => {
				original.handler(operation)
				return true
			},
			abort: () => undefined,
		}
		const channel = new StudyChannel(options)
		try {
			options.endpoint = second.child
			options.handle = async (operation: string) => {
				replacement.handler(operation)
				return true
			}
			const result = await new StudyDeadline({ duration: 2000, label: STUDY_PROCESS_LABEL }).wait(
				channel.request('goal', { public: 'input' }),
			)
			expect(result).toBe('original')
			expect(original.calls).toEqual([['admit']])
			expect(replacement.count).toBe(0)
			expect(first.child.listenerCount('message')).toBe(1)
			channel.close()
			expect(first.child.listenerCount('message')).toBe(0)
		} finally {
			channel.close()
			await Promise.allSettled([first.close(), second.close()])
			firstScratch.destroy()
			secondScratch.destroy()
		}
	}, 15000)

	it('caps 64 outbound pending calls, refuses the 65th and still resolves the original 64', async () => {
		const scratch = createScratch()
		const peer = createStudyPeer(
			scratch,
			`const frames = []
process.on('message', frame => {
	if (frame?.control === 'release') { for (const request of frames) process.send({id:request.id,operation:'reply',value:request.value}); return }
	if (frame?.operation !== 'goal') return
	frames.push(frame)
})`,
		)
		const channel = new StudyChannel({
			endpoint: peer.child,
			handle: async () => true,
			abort: () => undefined,
		})
		try {
			const pending = Array.from({ length: STUDY_PENDING_LIMIT }, (_, index) =>
				channel.request('goal', { index }),
			)
			for (const response of pending) void response.catch(() => undefined)
			await expect(channel.request('goal', { index: STUDY_PENDING_LIMIT })).rejects.toMatchObject({
				failure: { cause: 'infrastructure', message: 'Study IPC pending limit exceeded' },
			})
			expect(channel.signal.aborted).toBe(false)
			// IPC sends preserve order; release follows the 64 accepted request frames.
			peer.child.send({ control: 'release' })
			await expect(
				new StudyDeadline({ duration: 3000, label: 'outbound pending replies' }).wait(
					Promise.all(pending),
				),
			).resolves.toEqual(Array.from({ length: STUDY_PENDING_LIMIT }, (_, index) => ({ index })))
		} finally {
			channel.close()
			await peer.close()
			scratch.destroy()
		}
	}, 10000)

	it('closes on the 65th inbound request, refuses its work and rejects pending outbound work', async () => {
		const scratch = createScratch()
		const peer = createStudyPeer(
			scratch,
			`let replies = 0
process.on('message', frame => {
	if (frame?.control === 'start') { for (let id = 1; id <= ${String(STUDY_PENDING_LIMIT + 1)}; id++) process.send({id,operation:'goal',value:{id}}); return }
	if (frame?.operation === 'reply') { replies++; if (replies === ${String(STUDY_PENDING_LIMIT)}) process.send({control:'replied',count:replies}) }
})`,
		)
		const gate = Promise.withResolvers<void>()
		let active = 0
		const channel = new StudyChannel({
			endpoint: peer.child,
			handle: async () => {
				active++
				await gate.promise
				return true
			},
			abort: () => undefined,
		})
		try {
			const replied = waitForEvent(
				(listener: (value: unknown) => void) => {
					const onMessage = (value: unknown): void => {
						if (isRecord(value) && value.control === 'replied') listener(value.count)
					}
					peer.child.on('message', onMessage)
					return () => {
						peer.child.off('message', onMessage)
					}
				},
				'peer received all accepted replies',
				{ budget: 3000 },
			)
			const outbound = channel.request('goal', { held: true })
			const refused = Promise.allSettled([outbound])
			peer.child.send({ control: 'start' })
			await waitForCondition('accepted handlers are active', () => active === STUDY_PENDING_LIMIT, {
				budget: 3000,
				interval: 10,
			})
			await waitForAbort(channel.signal)
			expect(active).toBe(STUDY_PENDING_LIMIT)
			expect(channel.signal.reason).toMatchObject({
				failure: {
					cause: 'infrastructure',
					message: 'Out-of-order or excessive study IPC request',
				},
			})
			expect(await refused).toMatchObject([
				{
					status: 'rejected',
					reason: {
						failure: {
							cause: 'infrastructure',
							message: 'Out-of-order or excessive study IPC request',
						},
					},
				},
			])
			gate.resolve()
			expect((await replied)[0]).toBe(STUDY_PENDING_LIMIT)
		} finally {
			gate.resolve()
			channel.close()
			await peer.close()
			scratch.destroy()
		}
	}, 10000)
})
