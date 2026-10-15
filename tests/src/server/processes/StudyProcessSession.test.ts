import { createScratch } from '@orkestrel/test/server'
import { describe, expect, it } from 'vitest'
import { StudyDeadline } from '../../../../src/core/engines/StudyDeadline.js'
import { STUDY_PROCESS_LABEL } from '../../../../src/server/processes/constants.js'
import { StudyProcessSession } from '../../../../src/server/processes/StudyProcessSession.js'
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
	if (frame.operation === 'open') process.send({version:1,id:frame.id,operation:'reply',value:{pid:process.pid,subject:frame.value.identity.subject,instrument:frame.value.identity.instrument}})
	if (frame.operation === 'close') process.send({version:1,id:frame.id,operation:'reply',value:true})
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
		const declared = JSON.parse(
			JSON.stringify({ trial: options.trial, profile: options.profile, identity: options.identity }),
		)
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
			const frames: Array<{ operation: string; value: unknown }> = (
				scratch.read('frames.ndjson') ?? ''
			)
				.split('\n')
				.filter((line) => line !== '')
				.map((line) => JSON.parse(line))
			expect(frames.map((frame) => frame.operation)).toEqual(['open', 'abort', 'close'])
			expect(frames[0]?.value).toMatchObject(declared)
			expect(foreign.signal.aborted).toBe(false)
		} finally {
			controller.abort()
			await session.close().catch(() => undefined)
			scratch.destroy()
		}
	}, 20000)
})
