import { createScratch } from '@orkestrel/test/server'
import { describe, expect, it } from 'vitest'
import { StudyChannel } from '../../../../src/server/processes/StudyChannel.js'
import { STUDY_PROCESS_LABEL } from '../../../../src/server/processes/constants.js'
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
				if (action === 'failure') { process.send({version:1,id:frame.id,operation:'error',value:{invalid:true}}); return }
				if (action === 'oversized') { process.send({version:1,id:frame.id,operation:'reply',value:'x'.repeat(16*1024*1024)}); return }
				process.send({version:1,id:action === 'foreign' ? frame.id+1 : frame.id,operation:'reply',value:frame.value})
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
			`process.send({version:1,id:2,operation:'admit',value:{}}); process.on('message',()=>{})`,
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
})
