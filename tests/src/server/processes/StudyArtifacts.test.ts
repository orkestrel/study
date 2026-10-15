import { createScratch } from '@orkestrel/test/server'
import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { StudyArtifacts } from '../../../../src/server/processes/StudyArtifacts.js'
import { buildStudyProfile } from '../../../setupStudy.js'

describe('StudyArtifacts', () => {
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
			const artifacts = new StudyArtifacts({
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
			const renewed = new StudyArtifacts({
				entry,
				adapter,
				root: realpathSync(resolve('.')),
				profile,
			})
			expect((await renewed.inspect()).subject).not.toBe(identity.subject)
			scratch.write('instrument.cjs', 'throw new Error("changed instrument")')
			expect(() => renewed.verify()).toThrow(/instrument bytes drifted/)
			expect(
				() => new StudyArtifacts({ entry: 'relative.cjs', adapter, root: resolve('.'), profile }),
			).toThrow(/absolute/)
			expect(
				() =>
					new StudyArtifacts({
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
			const roots = [scratch.path]
			const occurrences = ['first', 'second'].map((name) => {
				scratch.write(
					`${name}/package.json`,
					JSON.stringify({ name: 'fixture-agent', version: '1.0.0', type: 'module' }),
				)
				roots.push(scratch.ensure(name))
				return scratch.write(`${name}/dist/index.js`, `throw new Error("${name} must not execute")`)
			})
			const [first, second] = occurrences
			if (first === undefined || second === undefined) throw new Error('Missing occurrence')
			const options = { entry, adapter, root: realpathSync(resolve('.')) }
			const profile = { ...buildStudyProfile(), subject, roots }
			const selectedFirst = await new StudyArtifacts({
				...options,
				profile: { ...profile, agent: first },
			}).inspect()
			const selectedSecond = await new StudyArtifacts({
				...options,
				profile: { ...profile, agent: second },
			}).inspect()
			expect(selectedFirst.subject).toBe(selectedFirst.agent)
			expect(selectedFirst.agent).not.toBe(selectedSecond.agent)
			const repeated = await new StudyArtifacts({
				...options,
				profile: { ...profile, agent: first },
			}).inspect()
			expect(repeated).toEqual(selectedFirst)
			scratch.write('first/dist/index.js', 'throw new Error("first changed")')
			const changed = await new StudyArtifacts({
				...options,
				profile: { ...profile, agent: first },
			}).inspect()
			expect(changed.agent).not.toBe(selectedFirst.agent)
		} finally {
			scratch.destroy()
		}
	})
})
