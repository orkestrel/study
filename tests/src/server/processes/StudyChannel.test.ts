import { createScratch } from '@orkestrel/test/server'
import { fork } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { StudyChannel } from '../../../../src/server/processes/StudyChannel.js'
import { awaitStudyProcess } from '../../../../src/server/processes/handlers.js'
import { readStudyFailure } from '../../../../src/core/engines/helpers.js'

describe('StudyChannel', () => {
	it('correlates real child replies and rejects malformed, foreign, oversized and premature endings', async () => {
		for (const action of ['echo', 'malformed', 'foreign', 'failure', 'oversized', 'exit']) {
			const scratch = createScratch()
			const entry = scratch.write(
				'peer.cjs',
				`process.on('message', frame => {
				const action = ${JSON.stringify(action)}
				if (action === 'exit') { process.exit(7); return }
				if (action === 'malformed') { process.send({invalid:true}); return }
				if (action === 'failure') { process.send({version:1,id:frame.id,operation:'error',value:{invalid:true}}); return }
				if (action === 'oversized') { process.send({version:1,id:frame.id,operation:'reply',value:'x'.repeat(16*1024*1024)}); return }
				process.send({version:1,id:action === 'foreign' ? frame.id+1 : frame.id,operation:'reply',value:frame.value})
			})`,
			)
			const child = fork(entry, [], { execArgv: [], silent: true, windowsHide: true })
			const exited = new Promise<void>((resolve) => child.once('close', () => resolve()))
			const channel = new StudyChannel({
				endpoint: child,
				handle: async () => true,
				abort: () => undefined,
			})
			try {
				const response = awaitStudyProcess(channel.request('goal', { public: 'input' }), 2000)
				const outcome = await response.then(
					(value) => ({ value }),
					(error: unknown) => ({ failure: readStudyFailure(error).cause }),
				)
				expect(outcome).toEqual(
					action === 'echo' ? { value: { public: 'input' } } : { failure: 'infrastructure' },
				)
			} finally {
				channel.close()
				if (child.exitCode === null && child.signalCode === null) child.kill()
				await awaitStudyProcess(exited, 2000)
				expect(child.listenerCount('message')).toBe(0)
				scratch.destroy()
			}
		}
	}, 15000)

	it('refuses nonsequential requests before invoking the domain handler', async () => {
		const scratch = createScratch()
		const entry = scratch.write(
			'peer.cjs',
			`process.send({version:1,id:2,operation:'admit',value:{}}); process.on('message',()=>{})`,
		)
		const child = fork(entry, [], { execArgv: [], silent: true, windowsHide: true })
		const exited = new Promise<void>((resolve) => child.once('close', () => resolve()))
		const operations: string[] = []
		const channel = new StudyChannel({
			endpoint: child,
			handle: async (operation) => {
				operations.push(operation)
				return true
			},
			abort: () => undefined,
		})
		try {
			await awaitStudyProcess(
				new Promise<void>((resolve) =>
					channel.signal.addEventListener('abort', () => resolve(), { once: true }),
				),
				2000,
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
			child.kill()
			await awaitStudyProcess(exited, 2000)
			scratch.destroy()
		}
	})
})
