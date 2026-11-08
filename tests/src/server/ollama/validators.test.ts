import { matchesStudyKeyedRoles } from '../../../../src/server/ollama/validators.js'
import { describe, expect, it } from 'vitest'
import {
	isStudyOllamaMetadata,
	isStudyOllamaModel,
	isStudyOllamaPolicy,
	isStudyOllamaStep,
	isStudySystemOnePolicy,
} from '../../../../src/server/ollama/validators.js'
import {
	buildOllamaDeclaration,
	buildOllamaStep,
	buildOllamaTransportOptions,
} from '../../../setupServer.js'
import { isStudyExchangeDeclaration } from '../../../../src/server/stores/validators.js'
import { STUDY_OLLAMA_CAPTURE_LENGTHS } from '../../../setupStudy.js'
import { hashStudyBytes } from '../../../../src/server/helpers.js'

describe('Ollama declaration guards', () => {
	it('validates the System One total ceiling without generation options', () => {
		expect(isStudySystemOnePolicy({ model: 'decision', tokens: 128 })).toBe(true)
		for (const tokens of STUDY_OLLAMA_CAPTURE_LENGTHS)
			expect(isStudySystemOnePolicy({ model: 'decision', tokens })).toBe(false)
		expect(isStudySystemOnePolicy({ model: '', tokens: 128 })).toBe(false)
		expect(isStudySystemOnePolicy({ model: 'decision', tokens: '128' })).toBe(false)
		expect(isStudySystemOnePolicy(buildOllamaStep().policy)).toBe(false)
	})
	it('admits triage exact and capture steps only with their System One policy and route', () => {
		const body = JSON.stringify({ model: 'decision', state: 'remember', questions: {} })
		const step = {
			ordinal: 1,
			goal: 'write',
			role: 'triage',
			path: '/v1/systemone',
			policy: { model: 'decision', tokens: 128 },
			admission: 'exact',
			body,
			input: hashStudyBytes(body),
		}
		expect(isStudyOllamaStep(step)).toBe(true)
		const declaration = buildOllamaDeclaration()
		expect(
			isStudyExchangeDeclaration({
				...declaration,
				goals: ['write'],
				models: { ...declaration.models, triage: { name: 'decision', digest: 'c'.repeat(64) } },
				procedure: [step],
			}),
		).toBe(true)
		const { body: _body, input: _input, ...identity } = step
		expect(
			isStudyOllamaStep({ ...identity, admission: 'capture', bytes: Buffer.byteLength(body) }),
		).toBe(true)
		expect(isStudyOllamaStep({ ...step, path: '/api/generate' })).toBe(false)
		expect(isStudyOllamaStep({ ...step, policy: buildOllamaStep().policy })).toBe(false)
		expect(isStudyOllamaStep({ ...step, role: 'judge', path: '/api/generate' })).toBe(false)
		for (const tokens of STUDY_OLLAMA_CAPTURE_LENGTHS)
			expect(isStudyOllamaStep({ ...step, policy: { model: 'decision', tokens } })).toBe(false)
	})
	it('accepts declared metadata, pinned models, policies and both admission contracts', () => {
		const options = buildOllamaTransportOptions('http://127.0.0.1:1')
		expect(isStudyOllamaMetadata(options.metadata)).toBe(true)
		expect(isStudyOllamaModel(options.models.model)).toBe(true)
		expect(isStudyOllamaPolicy(options.roles.agent)).toBe(true)
		expect(isStudyOllamaStep(buildOllamaStep('capture'))).toBe(true)
		expect(isStudyOllamaStep(buildOllamaStep('exact'))).toBe(true)
	})

	it.each(STUDY_OLLAMA_CAPTURE_LENGTHS)('refuses invalid positive allowances %s', (value) => {
		expect(isStudyOllamaStep({ ...buildOllamaStep(), bytes: value })).toBe(false)
		expect(isStudyOllamaMetadata({ calls: value, bytes: 32, duration: 1000 })).toBe(false)
		expect(isStudyOllamaMetadata({ calls: 8, bytes: value, duration: 1000 })).toBe(false)
	})

	it('refuses changed receipts, forbidden own fields, identities and nonfinite options', () => {
		const exact = buildOllamaStep('exact')
		expect(isStudyOllamaStep({ ...exact, input: 'f'.repeat(64) })).toBe(false)
		expect(isStudyOllamaStep({ ...exact, bytes: undefined })).toBe(false)
		expect(isStudyOllamaStep({ ...buildOllamaStep(), input: undefined })).toBe(false)
		expect(isStudyOllamaStep({ ...buildOllamaStep(), ordinal: 0 })).toBe(false)
		expect(isStudyOllamaStep({ ...buildOllamaStep(), role: 'maintenance' })).toBe(false)
		expect(isStudyOllamaStep({ ...buildOllamaStep(), path: '/api/generate' })).toBe(false)
		expect(
			isStudyOllamaPolicy({ ...exact.policy, options: { num_predict: 1, temperature: Infinity } }),
		).toBe(false)
		expect(isStudyOllamaModel({ name: 'model', digest: 'x'.repeat(64) })).toBe(false)
		expect(isStudyOllamaMetadata({ calls: 1, bytes: 1, duration: NaN })).toBe(false)
	})

	it('contains revoked proxies and throwing accessors without throwing', () => {
		const proxy = Proxy.revocable({}, {})
		proxy.revoke()
		const getter = Object.defineProperty({}, 'ordinal', {
			enumerable: true,
			get: () => {
				throw new Error('unreadable')
			},
		})
		expect(isStudyOllamaStep(proxy.proxy)).toBe(false)
		expect(isStudyOllamaStep(getter)).toBe(false)
		expect(isStudyOllamaMetadata(proxy.proxy)).toBe(false)
		expect(isStudyOllamaModel(proxy.proxy)).toBe(false)
		expect(isStudyOllamaPolicy(proxy.proxy)).toBe(false)
		expect(isStudySystemOnePolicy(proxy.proxy)).toBe(false)
		expect(
			isStudySystemOnePolicy(
				Object.defineProperty({}, 'model', {
					get: () => {
						throw new Error('unreadable')
					},
				}),
			),
		).toBe(false)
	})
})

describe('matchesStudyKeyedRoles', () => {
	it('admits triage for live and offline keyed replay', () => {
		expect(matchesStudyKeyedRoles(['triage'], false)).toBe(true)
		expect(matchesStudyKeyedRoles(['triage', 'metadata'], true)).toBe(true)
		expect(matchesStudyKeyedRoles(['triage', 'metadata'], false)).toBe(false)
		expect(matchesStudyKeyedRoles(['triage', 'triage'], true)).toBe(false)
	})
	it('admits metadata only offline and refuses a role with no recorded request', () => {
		expect(matchesStudyKeyedRoles(['judge', 'agent', 'summary'], false)).toBe(true)
		expect(matchesStudyKeyedRoles(['metadata', 'judge'], true)).toBe(true)
		for (const roles of [['metadata'], ['metadata', 'judge']])
			expect(matchesStudyKeyedRoles(roles, false)).toBe(false)
		for (const roles of [[], ['tool'], ['maintenance'], ['judge', 'judge'], 'judge', undefined])
			expect(matchesStudyKeyedRoles(roles, true)).toBe(false)
	})
})
