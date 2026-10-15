import { requireValue, waitForCondition, waitForEvent } from '@orkestrel/test'
import { createScratch, isRunning } from '@orkestrel/test/server'
import { execFileSync, fork, spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { isRecord } from '@orkestrel/contract'
import { isStudyBounds } from '../src/core/validators.js'
import { buildStudyRubric } from './setupStudy.js'
import {
	STUDY_CHECK_FINGERPRINT,
	STUDY_LAUNCHER_PID,
	buildCustodyGrading,
	buildCustodyLabels,
	buildCustodyPacketLabels,
	buildStudyCLI,
	buildStudyLibrary,
	createArtifactWorker,
	createStudyPeer,
	executeStudyCLI,
	readStudyCommands,
	readStudyOrphan,
	readStudyPid,
	releaseStudyPid,
	retainStudyFixture,
	writeStudyCheckEntry,
	writeStudyConsumer,
	writeStudyLauncherEntry,
	writeStudyOrphan,
} from './setupServer.js'

describe('study server fixtures', () => {
	it('builds the native CLI and supplies a checkable consumer without importing its subject', async () => {
		const scratch = createScratch({ parent: resolve('tmp/units'), prefix: 'setup-cli-' })
		try {
			writeStudyConsumer(scratch)
			const entry = await buildStudyCLI(scratch)
			const checked = await executeStudyCLI(entry, scratch.path, ['check', 'assessment'])
			expect(checked.code).toBe(0)
			expect(() => JSON.parse(checked.output)).not.toThrow()
			const refused = await executeStudyCLI(entry, scratch.path, ['check', 'missing'])
			expect(refused.code).not.toBe(0)
		} finally {
			scratch.destroy()
		}
	})
	it('builds the core library as a separate importable package with its own error class', async () => {
		const scratch = createScratch({ parent: resolve('tmp/units'), prefix: 'setup-library-' })
		try {
			const entry = await buildStudyLibrary(scratch)
			expect(entry).toBe(join(scratch.path, 'library', 'dist', 'index.js'))
			expect(scratch.read('library/package.json')).toContain('"type":"module"')
			const constructed = execFileSync(
				process.execPath,
				[
					'--input-type=module',
					'--eval',
					`import { StudyError } from ${JSON.stringify(pathToFileURL(entry).href)}; const error = new StudyError('CONFIG', 'Built refusal'); console.log(error.name + ':' + error.code + ':' + error.message)`,
				],
				{ encoding: 'utf8', timeout: 10000, windowsHide: true },
			)
			expect(constructed).toBe('StudyError:CONFIG:Built refusal\n')
		} finally {
			scratch.destroy()
		}
	})
	it('creates an executable native artifact worker in its owned scratch directory', () => {
		const scratch = createScratch()
		try {
			const worker = createArtifactWorker(
				scratch,
				"assert.equal(typeof Artifacts, 'function'); console.log('artifact-ready')",
			)
			expect(
				execFileSync(process.execPath, [worker], {
					encoding: 'utf8',
					timeout: 10000,
					windowsHide: true,
				}),
			).toBe('artifact-ready\n')
		} finally {
			scratch.destroy()
		}
	})
	it('forks a scripted peer over real IPC and releases it idempotently after a bounded exit', async () => {
		const scratch = createScratch()
		try {
			const peer = createStudyPeer(scratch, `process.on('message', (value) => process.send(value))`)
			const echoed = waitForEvent(
				(listener: (value: unknown) => void) => {
					peer.child.once('message', listener)
					return () => {
						peer.child.off('message', listener)
					}
				},
				'study peer echo',
				{ budget: 5000 },
			)
			peer.child.send({ ping: true })
			expect((await echoed)[0]).toEqual({ ping: true })
			await peer.close()
			await peer.close()
			expect(peer.child.exitCode !== null || peer.child.signalCode !== null).toBe(true)
			expect(peer.child.connected).toBe(false)
		} finally {
			scratch.destroy()
		}
	})
	it('leaves a live detached leaf after its root exits and cleans only the recorded leaf', async () => {
		const scratch = createScratch()
		let leaf: number | undefined
		try {
			const root = fork(writeStudyOrphan(scratch, 20000), [], {
				execArgv: [],
				silent: true,
				windowsHide: true,
			})
			const exited = waitForEvent(
				(listener: () => void) => {
					root.once('exit', listener)
					return () => {
						root.off('exit', listener)
					}
				},
				'orphan root exit',
				{ budget: 5000 },
			)
			root.send({ start: true })
			await exited
			await waitForCondition(
				'orphan receipt exists',
				() => readStudyOrphan(scratch) !== undefined,
				{
					budget: 3000,
					interval: 10,
				},
			)
			const receipt = requireValue(readStudyOrphan(scratch))
			leaf = receipt.leaf
			expect(receipt.root).toBe(root.pid)
			expect(isRunning(receipt.root)).toBe(false)
			expect(isRunning(receipt.leaf)).toBe(true)
			await releaseStudyPid(receipt.leaf)
			expect(isRunning(receipt.leaf)).toBe(false)
		} finally {
			await releaseStudyPid(leaf)
			scratch.destroy()
		}
	}, 15000)
	it('records the pid and command of a launcher entry and exits with the body outcome', () => {
		const scratch = createScratch()
		try {
			const entry = writeStudyLauncherEntry(scratch, 20000, "finish(7, 'answer')")
			expect(readStudyCommands(scratch)).toEqual([])
			const result = spawnSync(process.execPath, [entry, 'study-command', 'check', 'files'], {
				encoding: 'utf8',
				timeout: 10000,
				windowsHide: true,
			})
			expect(result.status).toBe(7)
			expect(result.stdout).toBe('answer')
			expect(readStudyPid(scratch, STUDY_LAUNCHER_PID)).toBe(result.pid)
			expect(readStudyCommands(scratch)).toEqual(['check files'])
		} finally {
			scratch.destroy()
		}
	})
	it('answers check with a valid reply at the requested duration and exits 0 for another command', () => {
		const scratch = createScratch()
		try {
			const entry = writeStudyCheckEntry(scratch, 86400000)
			const checked = spawnSync(process.execPath, [entry, 'study-command', 'check', 'files'], {
				encoding: 'utf8',
				timeout: 10000,
				windowsHide: true,
			})
			const reply: unknown = JSON.parse(checked.stdout)
			expect(checked.status).toBe(0)
			expect(isRecord(reply) && isStudyBounds(reply.bounds) && reply.bounds.series.duration).toBe(
				86400000,
			)
			expect(isRecord(reply) && reply.fingerprint).toBe(STUDY_CHECK_FINGERPRINT)
			const executed = spawnSync(process.execPath, [entry, 'study-command', 'execute', 'files'], {
				encoding: 'utf8',
				timeout: 10000,
				windowsHide: true,
			})
			expect(executed.status).toBe(0)
			expect(executed.stdout).toBe('')
			expect(readStudyCommands(scratch)).toEqual(['check files', 'execute files'])
		} finally {
			scratch.destroy()
		}
	})
	it('returns a sealed real-files fixture with complete grades and explicit supplied label provenance', async () => {
		const scratch = createScratch()
		try {
			const result = await retainStudyFixture(join(scratch.path, 'result'))
			const rubric = buildStudyRubric()
			const grading = buildCustodyGrading(result, rubric)
			const neutral = buildCustodyPacketLabels(result, rubric)
			expect(neutral.packet).not.toBe(result.seal.id)
			expect(neutral.judgments[0]?.trial).not.toBe(result.manifest.schedule[0]?.id)
			expect(neutral.judgments[0]?.criterion).not.toBe('first-read')
			expect(grading.attempts).toEqual(result.manifest.schedule.map((trial) => trial.id))
			expect(
				grading.judgments
					.filter((judgment) => judgment.method === 'human')
					.every((judgment) => judgment.verdict === 'unknown'),
			).toBe(true)
			const labels = buildCustodyLabels(result, 'supplied-human')
			expect(labels.labeler).toBe('supplied-human')
			expect(labels.created).toBe('2026-10-14T12:00:00.000Z')
			expect(buildCustodyGrading(result, rubric, labels).judgments).toEqual(
				expect.arrayContaining([...labels.judgments]),
			)
		} finally {
			scratch.destroy()
		}
	})
})
