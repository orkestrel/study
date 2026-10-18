import type { JSONValue } from '@orkestrel/contract'
import { describe, expect, it } from 'vitest'
import { StudyOllamaGoal } from '../../../../src/server/ollama/StudyOllamaGoal.js'
import { createOllamaContext } from '../../../setupServer.js'

describe('StudyOllamaGoal', () => {
	it('holds the activity it was given', () => {
		const context = createOllamaContext()
		try {
			const activity = { goal: 'first', context: context.context, checkpoint: undefined }
			expect(new StudyOllamaGoal(activity).activity).toBe(activity)
		} finally {
			context.close()
		}
	})

	it('hands out the checkpoint once and then none', () => {
		const context = createOllamaContext()
		try {
			const checkpoint = { view: 'first' }
			const goal = new StudyOllamaGoal({ goal: 'first', context: context.context, checkpoint })
			expect(goal.attach()).toBe(checkpoint)
			expect(goal.attach()).toBeUndefined()
			expect(goal.attach()).toBeUndefined()
		} finally {
			context.close()
		}
	})

	it('hands out nothing for a goal without a checkpoint', () => {
		const context = createOllamaContext()
		try {
			const goal = new StudyOllamaGoal({
				goal: 'first',
				context: context.context,
				checkpoint: undefined,
			})
			expect(goal.attach()).toBeUndefined()
			expect(goal.attach()).toBeUndefined()
		} finally {
			context.close()
		}
	})

	it('hands out a null checkpoint once as null', () => {
		const context = createOllamaContext()
		try {
			const checkpoint: JSONValue = null
			const goal = new StudyOllamaGoal({ goal: 'first', context: context.context, checkpoint })
			expect(goal.attach()).toBeNull()
			expect(goal.attach()).toBeUndefined()
		} finally {
			context.close()
		}
	})

	it('hands each goal its own checkpoint once', () => {
		const context = createOllamaContext()
		try {
			const first = new StudyOllamaGoal({
				goal: 'first',
				context: context.context,
				checkpoint: { view: 'first' },
			})
			const second = new StudyOllamaGoal({
				goal: 'second',
				context: context.context,
				checkpoint: { view: 'second' },
			})
			expect(first.attach()).toEqual({ view: 'first' })
			expect(second.attach()).toEqual({ view: 'second' })
			expect(first.attach()).toBeUndefined()
			expect(second.attach()).toBeUndefined()
		} finally {
			context.close()
		}
	})
})
