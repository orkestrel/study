import { expect, it } from 'vitest'
import { StudyDaemonTrial } from '../../../../src/server/commands/StudyDaemonTrial.js'
import { buildStudyExchangeRows } from '../../../setupServer.js'
import { resolve } from 'node:path'

it('refuses a maintenance send before its journal opens', async () => {
	const declaration = buildStudyExchangeRows()[0]
	if (declaration?.phase !== 'declaration') throw new Error('Missing fixture declaration')
	const trial = new StudyDaemonTrial({
		destination: { path: resolve('tmp/units/absent-exchanges.jsonl'), declaration },
		signal: new AbortController().signal,
	})
	await expect(
		trial.fetch('http://127.0.0.1:1/api/generate', { method: 'POST', body: '{}' }),
	).rejects.toThrow('Daemon journal is not open')
})
