import { describe, expect, it } from 'vitest'
import { createOllamaExchange } from '../../../setupServer.js'

describe('StudyOllamaExchange', () => {
	it('counts response bytes from the request bytes and refuses a tally beyond the allowance with the request role', async () => {
		const fixture = await createOllamaExchange(10)
		try {
			expect(fixture.exchange.bytes).toBe(10)
			fixture.exchange.count(5, 20)
			expect(fixture.exchange.bytes).toBe(15)
			fixture.exchange.count(5, 20)
			expect(fixture.exchange.bytes).toBe(20)
			expect(() => fixture.exchange.count(1, 20)).toThrow(
				expect.objectContaining({
					code: 'CAPACITY',
					message: 'Ollama wire byte allowance exceeded',
					failure: expect.objectContaining({ cause: 'capacity', role: 'agent' }),
				}),
			)
			expect(fixture.exchange.bytes).toBe(21)
		} finally {
			fixture.close()
		}
	})

	it('retains decoded text and takes its complete lines while keeping the unfinished tail', async () => {
		const fixture = await createOllamaExchange()
		try {
			const encoded = new TextEncoder().encode('one\r\ntwo\nthr€')
			fixture.exchange.decode(encoded.subarray(0, encoded.length - 1))
			expect(fixture.exchange.text).toBe('one\r\ntwo\nthr')
			expect(fixture.exchange.take(false)).toEqual(['one', 'two'])
			expect(fixture.exchange.text).toBe('thr')
			fixture.exchange.decode(encoded.subarray(encoded.length - 1))
			expect(fixture.exchange.text).toBe('thr€')
			expect(fixture.exchange.take(true)).toEqual(['thr€'])
			expect(fixture.exchange.text).toBe('')
		} finally {
			fixture.close()
		}
	})

	it('refuses undecodable bytes and a response that ends inside a character', async () => {
		const fixture = await createOllamaExchange()
		try {
			expect(() => fixture.exchange.decode(new Uint8Array([0xff]))).toThrow(TypeError)
			const truncated = await createOllamaExchange()
			try {
				truncated.exchange.decode(new TextEncoder().encode('€').subarray(0, 2))
				expect(() => truncated.exchange.flush()).toThrow(TypeError)
			} finally {
				truncated.close()
			}
		} finally {
			fixture.close()
		}
	})

	it('retains a terminal with its timing and settles once', async () => {
		const fixture = await createOllamaExchange()
		try {
			expect(fixture.exchange.terminal).toBeUndefined()
			expect(fixture.exchange.timing).toBeUndefined()
			expect(fixture.exchange.settled).toBe(false)
			const terminal = { prompt: 3, completion: 4, reason: 'stop' }
			fixture.exchange.observe(terminal, undefined)
			expect(fixture.exchange.terminal).toBe(terminal)
			expect(fixture.exchange.timing).toBeUndefined()
			fixture.exchange.settle()
			expect(fixture.exchange.settled).toBe(true)
		} finally {
			fixture.close()
		}
	})
})
