import { describe, expect, it } from 'vitest'
import {
	isStudyOllamaMetadata,
	isStudyOllamaModel,
	isStudyOllamaPolicy,
	isStudyOllamaStep,
} from '../../../../src/server/ollama/validators.js'
import { buildOllamaStep, buildOllamaTransportOptions } from '../../../setupServer.js'
import { STUDY_OLLAMA_CAPTURE_LENGTHS } from '../../../setupStudy.js'

describe('Ollama declaration guards', () => {
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
	})
})
