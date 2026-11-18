import { createScratch } from '@orkestrel/test/server'
import { describe, expect, it } from 'vitest'
import { StudyDeadline } from '../../../../src/core/engines/StudyDeadline.js'
import { StudyTaskChild } from '../../../../src/server/processes/StudyTaskChild.js'
import {
	STUDY_TASK_INSTRUMENT,
	STUDY_TASK_REFUSALS,
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

	it('keeps a returned CONFIG or CUSTODY code and translates any other returned code to FAULT', async () => {
		for (const { mode, code } of STUDY_TASK_REFUSALS) {
			const scratch = createScratch()
			const child = new StudyTaskChild(
				buildStudyTaskOptions(writeStudyTaskAdapter(scratch, mode)),
				5000,
				new AbortController().signal,
			)
			try {
				await expect(
					new StudyDeadline({ duration: 8000, label: `StudyTaskChild ${mode} refusal` }).wait(
						child.execute({ operation: 'validate' }),
					),
				).rejects.toMatchObject({ code, message: 'Declared refusal' })
			} finally {
				await releaseStudyPid(readStudyPid(scratch, 'task-pid.txt'))
				scratch.destroy()
			}
		}
	}, 30000)

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
			).rejects.toMatchObject({
				code: 'FAULT',
				message: 'Adapter deadline exceeded',
				context: {
					cause: 'deadline',
					stop: { layer: 'scope', id: 'Adapter duration', max: 1500, consumed: undefined },
				},
			})
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
		const execution = child.execute({ operation: 'validate' })
		try {
			expect(() => child.execute({ operation: 'validate' })).toThrow(
				'Study task child can execute only once',
			)
			await new StudyDeadline({ duration: 8000, label: 'StudyTaskChild single run' }).wait(
				execution,
			)
		} finally {
			await Promise.allSettled([execution])
			await releaseStudyPid(readStudyPid(scratch, 'task-pid.txt'))
			scratch.destroy()
		}
	}, 15000)
})
