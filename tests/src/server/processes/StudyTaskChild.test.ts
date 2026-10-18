import { createScratch } from '@orkestrel/test/server'
import { describe, expect, it } from 'vitest'
import { StudyDeadline } from '../../../../src/core/engines/StudyDeadline.js'
import { StudyTaskChild } from '../../../../src/server/processes/StudyTaskChild.js'
import {
	STUDY_TASK_INSTRUMENT,
	buildStudyTaskOptions,
	readStudyPid,
	releaseStudyPid,
	writeStudyTaskAdapter,
} from '../../../setupServer.js'

describe('StudyTaskChild', () => {
	it('resolves the verified response of a valid adapter', async () => {
		const scratch = createScratch()
		const child = new StudyTaskChild(
			buildStudyTaskOptions(writeStudyTaskAdapter(scratch, 'valid')),
			5000,
			new AbortController().signal,
		)
		try {
			expect(
				await new StudyDeadline({ duration: 8000, label: 'StudyTaskChild response' }).wait(
					child.execute({ operation: 'validate' }),
				),
			).toEqual({ instrument: STUDY_TASK_INSTRUMENT, value: true })
		} finally {
			await releaseStudyPid(readStudyPid(scratch, 'task-pid.txt'))
			scratch.destroy()
		}
	}, 15000)

	it('rejects a held adapter at its deadline', async () => {
		const scratch = createScratch()
		const child = new StudyTaskChild(
			buildStudyTaskOptions(writeStudyTaskAdapter(scratch, 'hold')),
			1500,
			new AbortController().signal,
		)
		try {
			await expect(
				new StudyDeadline({ duration: 8000, label: 'StudyTaskChild deadline' }).wait(
					child.execute({ operation: 'validate' }),
				),
			).rejects.toMatchObject({ code: 'FAULT', message: 'Adapter deadline exceeded' })
		} finally {
			await releaseStudyPid(readStudyPid(scratch, 'task-pid.txt'))
			scratch.destroy()
		}
	}, 15000)

	it('refuses to supervise the same child twice', async () => {
		const scratch = createScratch()
		const child = new StudyTaskChild(
			buildStudyTaskOptions(writeStudyTaskAdapter(scratch, 'valid')),
			5000,
			new AbortController().signal,
		)
		const running = child.execute({ operation: 'validate' })
		try {
			expect(() => child.execute({ operation: 'validate' })).toThrow(
				'Study task child can execute only once',
			)
			await new StudyDeadline({ duration: 8000, label: 'StudyTaskChild single run' }).wait(running)
		} finally {
			await Promise.allSettled([running])
			await releaseStudyPid(readStudyPid(scratch, 'task-pid.txt'))
			scratch.destroy()
		}
	}, 15000)
})
