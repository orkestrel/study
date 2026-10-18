import { createScratch } from '@orkestrel/test/server'
import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { StudyArtifactLoader } from '../../../../src/server/processes/StudyArtifactLoader.js'
import { buildStudyProfile } from '../../../setupStudy.js'

describe('StudyArtifactLoader', () => {
	it('inspects complete built inventory without executing selected entries and binds instrument drift', async () => {
		const scratch = createScratch()
		try {
			const entry = scratch.write(
				'instrument.cjs',
				'throw new Error("instrument must not execute")',
			)
			scratch.write(
				'package.json',
				JSON.stringify({ name: '@orkestrel/study', version: '1.0.0', type: 'module' }),
			)
			const adapter = scratch.write('adapter/index.ts', 'export const adapter = true')
			const subject = scratch.write('dist/index.js', 'throw new Error("subject must not execute")')
			scratch.write('dist/unused.js', 'export const unused = true')
			const profile = { ...buildStudyProfile(), agent: subject, subject, roots: [scratch.path] }
			const artifacts = new StudyArtifactLoader({
				entry,
				adapter,
				root: realpathSync(resolve('.')),
				profile,
			})
			const identity = await artifacts.inspect()
			expect(identity.subject).toMatch(/^[a-f0-9]{64}$/)
			expect(identity.agent).toMatch(/^[a-f0-9]{64}$/)
			expect(identity.agent).toBe(identity.subject)
			expect(identity.instrument).not.toBe(identity.subject)
			expect(identity.provider).toBeUndefined()
			expect(await artifacts.inspect()).toEqual(identity)
			scratch.write('dist/unused.js', 'export const unused = false')
			expect(() => artifacts.verify()).toThrow(/inventory drifted/)
			const renewed = new StudyArtifactLoader({
				entry,
				adapter,
				root: realpathSync(resolve('.')),
				profile,
			})
			expect((await renewed.inspect()).subject).not.toBe(identity.subject)
			scratch.write('instrument.cjs', 'throw new Error("changed instrument")')
			expect(() => renewed.verify()).toThrow(/instrument bytes drifted/)
			expect(
				() =>
					new StudyArtifactLoader({ entry: 'relative.cjs', adapter, root: resolve('.'), profile }),
			).toThrow(/absolute/)
			expect(
				() =>
					new StudyArtifactLoader({
						entry,
						adapter,
						root: resolve('.'),
						profile: { ...profile, agent: 'agent-v1' },
					}),
			).toThrow(/absolute/)
		} finally {
			scratch.destroy()
		}
	})

	it('binds the selected agent occurrence and its bytes into the identity without evaluating any entry', async () => {
		const scratch = createScratch()
		try {
			const entry = scratch.write(
				'instrument.cjs',
				'throw new Error("instrument must not execute")',
			)
			scratch.write(
				'package.json',
				JSON.stringify({ name: '@orkestrel/study', version: '1.0.0', type: 'module' }),
			)
			const adapter = scratch.write('adapter/index.ts', 'export const adapter = true')
			const subject = scratch.write('dist/index.js', 'throw new Error("subject must not execute")')
			const occurrences = ['first', 'second'].map((name) => {
				scratch.write(
					`${name}/package.json`,
					JSON.stringify({ name: 'fixture-agent', version: '1.0.0', type: 'module' }),
				)
				const root = scratch.ensure(name)
				return {
					root,
					agent: scratch.write(
						`${name}/dist/index.js`,
						`throw new Error("${name} must not execute")`,
					),
				}
			})
			const roots = [scratch.path, ...occurrences.map(({ root }) => root)]
			const [first, second] = occurrences.map(({ agent }) => agent)
			if (first === undefined || second === undefined) throw new Error('Missing occurrence')
			const options = { entry, adapter, root: realpathSync(resolve('.')) }
			const profile = { ...buildStudyProfile(), subject, roots }
			const selectedFirst = await new StudyArtifactLoader({
				...options,
				profile: { ...profile, agent: first },
			}).inspect()
			const selectedSecond = await new StudyArtifactLoader({
				...options,
				profile: { ...profile, agent: second },
			}).inspect()
			expect(selectedFirst.subject).toBe(selectedFirst.agent)
			expect(selectedFirst.agent).not.toBe(selectedSecond.agent)
			const repeated = await new StudyArtifactLoader({
				...options,
				profile: { ...profile, agent: first },
			}).inspect()
			expect(repeated).toEqual(selectedFirst)
			scratch.write('first/dist/index.js', 'throw new Error("first changed")')
			const changed = await new StudyArtifactLoader({
				...options,
				profile: { ...profile, agent: first },
			}).inspect()
			expect(changed.agent).not.toBe(selectedFirst.agent)
		} finally {
			scratch.destroy()
		}
	})
})
