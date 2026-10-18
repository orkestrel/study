import { createScratch } from '@orkestrel/test/server'
import { waitForDelay } from '@orkestrel/test'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { StudyProcessDriver } from '../../../../src/server/processes/StudyProcessDriver.js'
import {
	buildStudyManifest,
	buildStudyProfile,
	buildCustodyManifest,
	createStudyMeterFixture,
} from '../../../setupStudy.js'
import { StudyResultStore } from '../../../../src/server/stores/StudyResultStore.js'
import { join } from 'node:path'

describe('StudyProcessDriver', () => {
	it('denies a real child request before dispatch through the actual parent meter', async () => {
		const scratch = createScratch()
		const fixture = createStudyMeterFixture()
		try {
			const marker = join(scratch.path, 'dispatched.txt')
			const entry = scratch.write(
				'peer.cjs',
				`const fs=require('node:fs'); process.on('message',frame=>{
				if(frame.operation==='open')process.send({id:frame.id,operation:'reply',value:{pid:process.pid,...frame.value.identity}})
				if(frame.operation==='goal'){process.send({id:1,operation:'admit',value:{id:1,charge:{role:'tool',tokens:101,bytes:0}}});process.on('message',settled=>{
					if(settled.operation==='reply'&&settled.id===1){fs.writeFileSync(${JSON.stringify(marker)},'dispatched');process.send({id:frame.id,operation:'reply',value:{value:true,partial:false}})}
					if(settled.operation==='error')process.send({id:frame.id,operation:'error',value:settled.value})
				})}
				if(frame.operation==='close')process.send({id:frame.id,operation:'reply',value:true})
			})`,
			)
			const manifest = buildCustodyManifest()
			const trial = manifest.schedule[0]
			const goal = manifest.scenarios[0]?.goals[0]
			if (trial === undefined || goal === undefined) throw new Error('Fixture trial missing')
			const profile = { ...buildStudyProfile(), bounds: manifest.bounds }
			const store = new StudyResultStore({ directory: join(scratch.path, 'result'), manifest })
			await store.create()
			const evidence = await store.start(trial)
			const driver = new StudyProcessDriver({
				entry,
				root: resolve('.'),
				directory: scratch.path,
				identity: manifest.identity,
				driver: 'files',
				adapter: entry,
				profile,
			})
			const session = await driver.open(trial, new AbortController().signal)
			try {
				await expect(
					session.execute(goal, {
						signal: fixture.control.signal,
						meter: fixture.meter,
						evidence,
					}),
				).rejects.toMatchObject({ failure: { cause: 'capacity' } })
				expect(scratch.has('dispatched.txt')).toBe(false)
				expect(fixture.meter.usage).toEqual([])
				await store.finish({
					trial,
					observations:
						manifest.scenarios[0]?.goals.map((declared, index) => ({
							goal: declared.id,
							product: undefined,
							failure: fixture.control.failure,
							usage: [],
							duration: 0,
							executed: index === 0,
						})) ?? [],
					failure: fixture.control.failure,
					duration: 0,
					executed: true,
				})
			} finally {
				await session.close()
			}
		} finally {
			fixture.close()
			scratch.destroy()
		}
	})
	it('rejects malformed readiness, premature exit and output flooding from real children', async () => {
		for (const source of [
			`process.on('message',frame=>process.send({id:frame.id,operation:'reply',value:{pid:process.pid,subject:'foreign',instrument:'foreign'}}))`,
			`process.exit(7)`,
			`process.stdout.write('x'.repeat(65537));process.on('message',()=>{})`,
		]) {
			const scratch = createScratch()
			try {
				const entry = scratch.write('peer.cjs', source)
				const manifest = buildStudyManifest()
				const trial = manifest.schedule[0]
				if (trial === undefined) throw new Error('Fixture trial missing')
				const profile = buildStudyProfile()
				const driver = new StudyProcessDriver({
					entry,
					root: resolve('.'),
					directory: scratch.path,
					identity: manifest.identity,
					driver: 'files',
					adapter: entry,
					profile: {
						...profile,
						bounds: {
							...profile.bounds,
							request: { ...profile.bounds.request, duration: 1000 },
							trial: { ...profile.bounds.trial, duration: 2000 },
						},
					},
				})
				await expect(driver.open(trial, new AbortController().signal)).rejects.toMatchObject({
					code: 'FAULT',
				})
			} finally {
				scratch.destroy()
			}
		}
	}, 15000)

	it('interrupts a real unresponsive child and completes recorded-process cleanup', async () => {
		const scratch = createScratch()
		try {
			const entry = scratch.write('peer.cjs', `process.on('message',()=>{})`)
			const manifest = buildStudyManifest()
			const trial = manifest.schedule[0]
			if (trial === undefined) throw new Error('Fixture trial missing')
			const profile = buildStudyProfile()
			const driver = new StudyProcessDriver({
				entry,
				root: resolve('.'),
				directory: scratch.path,
				identity: manifest.identity,
				driver: 'files',
				adapter: entry,
				profile: {
					...profile,
					bounds: {
						...profile.bounds,
						request: { ...profile.bounds.request, duration: 30 },
						trial: { ...profile.bounds.trial, duration: 2000 },
					},
				},
			})
			const controller = new AbortController()
			const opened = driver.open(trial, controller.signal)
			const aborting = waitForDelay(30).then(() => controller.abort())
			await expect(opened).rejects.toMatchObject({ failure: { cause: 'interrupted' } })
			await aborting
		} finally {
			scratch.destroy()
		}
	})
})
