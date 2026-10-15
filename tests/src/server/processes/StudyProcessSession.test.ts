import { requireValue, waitForCondition } from '@orkestrel/test'
import { createScratch, isRunning } from '@orkestrel/test/server'
import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'
import { StudyDeadline } from '../../../../src/core/engines/StudyDeadline.js'
import {
	STUDY_DRAIN_DURATION,
	STUDY_PROCESS_LABEL,
} from '../../../../src/server/processes/constants.js'
import { StudyProcessSession } from '../../../../src/server/processes/StudyProcessSession.js'
import { toStudyWire } from '../../../../src/server/processes/helpers.js'
import { isStudyFrame } from '../../../../src/server/processes/validators.js'
import {
	buildStudySessionOptions,
	readStudyOrphan,
	releaseStudyPid,
	writeStudyOrphan,
} from '../../../setupServer.js'
import { buildCustodyManifest, buildStudyManifest, buildStudyProfile } from '../../../setupStudy.js'

describe('StudyProcessSession', () => {
	it('owns its opening declaration and cancellation after the caller mutates and replaces the options', async () => {
		const scratch = createScratch()
		const controller = new AbortController()
		const foreign = new AbortController()
		const options = {
			entry: scratch.write(
				'entry.cjs',
				`const fs = require('node:fs'), path = require('node:path')
process.on('message', frame => {
	fs.appendFileSync(path.join(__dirname, 'frames.ndjson'), JSON.stringify(frame) + '\\n')
	if (frame.operation === 'open') process.send({id:frame.id,operation:'reply',value:{pid:process.pid,subject:frame.value.identity.subject,instrument:frame.value.identity.instrument}})
	if (frame.operation === 'close') process.send({id:frame.id,operation:'reply',value:true})
})`,
			),
			root: scratch.path,
			directory: scratch.ensure('trials'),
			adapter: scratch.path,
			driver: 'memory',
			profile: {
				...buildStudyProfile(),
				bounds: buildCustodyManifest().bounds,
				roots: ['dist'],
			},
			identity: { ...buildStudyManifest().identity },
			trial: { id: 'trial-original', scenario: 'first', arm: 'small', repetition: 0 },
			signal: controller.signal,
		}
		const declared = structuredClone({
			trial: options.trial,
			profile: options.profile,
			identity: options.identity,
		})
		const session = new StudyProcessSession(options)
		try {
			options.trial.id = 'trial-mutated'
			options.profile.name = 'mutated'
			options.profile.roots.push('extra')
			options.identity.subject = 'e'.repeat(64)
			options.signal = foreign.signal
			const deadline = new StudyDeadline({ duration: 8000, label: STUDY_PROCESS_LABEL })
			await deadline.wait(session.start())
			controller.abort()
			await deadline.wait(session.close())
			const frames = (scratch.read('frames.ndjson') ?? '')
				.split('\n')
				.filter((line) => line !== '')
				.map((line) => {
					const frame: unknown = JSON.parse(line)
					if (!isStudyFrame(frame)) throw new Error('Fixture received an invalid Study frame')
					return frame
				})
			expect(frames.map((frame) => frame.operation)).toEqual(['open', 'abort', 'close'])
			expect(frames[0]?.value).toMatchObject({
				trial: toStudyWire(declared.trial),
				profile: toStudyWire(declared.profile),
				identity: toStudyWire(declared.identity),
			})
			expect(foreign.signal.aborted).toBe(false)
		} finally {
			controller.abort()
			await session.close().catch(() => undefined)
			scratch.destroy()
		}
	}, 20000)

	it('closes an exited worker whose detached leaf holds inherited output before the leaf expires', async () => {
		const scratch = createScratch()
		const controller = new AbortController()
		const session = new StudyProcessSession(
			buildStudySessionOptions(scratch, writeStudyOrphan(scratch, 20000), controller.signal),
		)
		const before = process.getActiveResourcesInfo().filter((type) => /pipe/i.test(type)).length
		try {
			await expect(
				new StudyDeadline({ duration: 4000, label: 'orphaned session start' }).wait(
					session.start(),
				),
			).rejects.toBeDefined()
			const receipt = requireValue(readStudyOrphan(scratch))
			expect(isRunning(receipt.root)).toBe(false)
			expect(isRunning(receipt.leaf)).toBe(true)
			await expect(
				new StudyDeadline({ duration: 4000, label: 'orphaned session close' }).wait(
					session.close(),
				),
			).resolves.toBeUndefined()
			expect(isRunning(receipt.leaf)).toBe(true)
			await waitForCondition(
				'inherited worker pipes released while the leaf lives',
				() =>
					process.getActiveResourcesInfo().filter((type) => /pipe/i.test(type)).length <= before,
				{ budget: 3000, interval: 10 },
			)
			expect(isRunning(receipt.leaf)).toBe(true)
		} finally {
			await releaseStudyPid(readStudyOrphan(scratch)?.leaf)
			controller.abort()
			await session.close().catch(() => undefined)
			scratch.destroy()
		}
	}, 25000)

	it('closes an ordinary exited worker without waiting for the drain bound', async () => {
		const scratch = createScratch()
		const controller = new AbortController()
		const session = new StudyProcessSession(
			buildStudySessionOptions(
				scratch,
				scratch.write('exit.cjs', "process.on('message', () => process.exit(0))"),
				controller.signal,
			),
		)
		try {
			await expect(
				new StudyDeadline({ duration: 4000, label: 'ordinary session start' }).wait(
					session.start(),
				),
			).rejects.toBeDefined()
			const started = performance.now()
			await expect(
				new StudyDeadline({ duration: 4000, label: 'ordinary session close' }).wait(
					session.close(),
				),
			).resolves.toBeUndefined()
			expect(performance.now() - started).toBeLessThan(STUDY_DRAIN_DURATION)
		} finally {
			controller.abort()
			await session.close().catch(() => undefined)
			scratch.destroy()
		}
	}, 15000)
})
