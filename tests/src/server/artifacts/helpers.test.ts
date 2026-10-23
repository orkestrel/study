import { createScratch, destroyScratch } from '@orkestrel/test/server'
import { closeSync, openSync, opendirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { ArtifactError, isArtifactError } from '../../../../src/server/artifacts/errors.js'
import {
	iterateArtifactEntries,
	readArtifact,
	readArtifactBytes,
	matchesArtifactCredential,
	readArtifactPhysical,
	resolveArtifactMember,
	resolveArtifactBase,
	relocateArtifactPath,
	computeArtifactClosureDigest,
	verifyArtifactClosure,
} from '../../../../src/server/artifacts/helpers.js'
import { ArtifactLoader } from '../../../../src/server/artifacts/ArtifactLoader.js'
import {
	ARTIFACT_BENIGN_NAMES,
	ARTIFACT_CREDENTIAL_NAMES,
	ARTIFACT_REFUSED_KEYS,
	ARTIFACT_CLOSURE_FILES,
	buildArtifactClosureOptions,
} from '../../../setupServer.js'

it('recognizes branded artifact refusals and refuses malformed members and proxies', () => {
	class DerivedArtifactError extends ArtifactError {
		constructor() {
			super('Subclass refusal', 'DRIFT')
			this.name = 'DerivedArtifactError'
		}
	}
	const error = new DerivedArtifactError()
	const brand = Symbol.for('@orkestrel/study.ArtifactError')
	expect(Object.getOwnPropertyDescriptor(error, brand)).toMatchObject({
		value: error,
		enumerable: false,
		writable: false,
	})
	expect(isArtifactError(error)).toBe(true)
	expect(isArtifactError(new Proxy(error, {}))).toBe(false)
	expect(isArtifactError(Object.assign(new Error('Look-alike'), { code: 'DRIFT' }))).toBe(false)
	const plain = {}
	Object.defineProperty(plain, brand, { value: plain })
	expect(isArtifactError(plain)).toBe(false)
	const revoked = Proxy.revocable(error, {})
	revoked.revoke()
	expect(isArtifactError(revoked.proxy)).toBe(false)
	const invalid = new ArtifactError('Invalid code')
	Object.defineProperty(invalid, 'code', { value: 'CONFIG' })
	expect(isArtifactError(invalid)).toBe(false)
	const malformed = new ArtifactError('Invalid member')
	Object.defineProperty(malformed, 'message', { value: 7 })
	expect(isArtifactError(malformed)).toBe(false)
	const access = new ArtifactError('Throwing member')
	Object.defineProperty(access, 'code', {
		get: () => {
			throw new Error('Unreadable code')
		},
	})
	expect(isArtifactError(access)).toBe(false)
})

it('refuses exact credential names and portable key hazards before reading while retaining benign case variants', () => {
	for (const name of ARTIFACT_REFUSED_KEYS.flatMap((part) => [part, part.toUpperCase()])) {
		expect(() => resolveArtifactMember(process.cwd(), name)).toThrow(ArtifactError)
	}
	for (const name of ARTIFACT_CREDENTIAL_NAMES)
		expect(() => readArtifactPhysical(join(process.cwd(), 'nonexistent', name))).toThrow(
			ArtifactError,
		)
	for (const name of ARTIFACT_BENIGN_NAMES.flatMap((part) => [part, part.toUpperCase()])) {
		expect(matchesArtifactCredential(name)).toBe(false)
		expect(resolveArtifactMember(process.cwd(), `plain/${name}/plain.txt`)).toBe(
			join(process.cwd(), 'plain', name, 'plain.txt'),
		)
	}
	expect(matchesArtifactCredential('api-token.txt')).toBe(true)
})

it('admits benign credential-like physical ancestors in either case', () => {
	const scratch = createScratch()
	try {
		for (const name of ARTIFACT_BENIGN_NAMES.flatMap((part) => [part, part.toUpperCase()])) {
			const path = scratch.ensure(join(Buffer.from(name).toString('hex'), name, 'plain'))
			expect(readArtifactPhysical(path).isDirectory()).toBe(true)
		}
	} finally {
		scratch.destroy()
	}
})

it('verifies complete independent membership and portable keys and excludes provenance from the digest', async () => {
	const scratch = createScratch({ files: ARTIFACT_CLOSURE_FILES })
	try {
		const closure = await new ArtifactLoader(buildArtifactClosureOptions(scratch)).materialize(
			join(scratch.path, 'copy'),
		)
		verifyArtifactClosure(closure)
		expect(resolveArtifactBase(closure.members.map((member) => member.source))).toBe(
			join(scratch.path, 'subject'),
		)
		expect(relocateArtifactPath(closure, join(scratch.path, 'subject'))).toBe(closure.destination)
		expect(() => relocateArtifactPath(closure, scratch.path)).toThrow(/traverses/)
		const inventory = new ArtifactLoader(closure.options).inspect()
		expect(
			computeArtifactClosureDigest(closure.members, inventory.packages, closure.destination),
		).toBe(closure.digest)
		expect(
			computeArtifactClosureDigest(
				closure.members.map((member) => ({ ...member, source: 'ignored-provenance' })),
				inventory.packages,
				closure.destination,
			),
		).toBe(closure.digest)
		const member = closure.members[0]
		if (member === undefined) throw new Error('Missing copied member')
		expect(() =>
			verifyArtifactClosure({ ...closure, members: [...closure.members, member] }),
		).toThrow(/duplicated/)
		for (const key of ARTIFACT_REFUSED_KEYS)
			expect(() =>
				verifyArtifactClosure({
					...closure,
					members: [{ ...member, key }, ...closure.members.slice(1)],
				}),
			).toThrow(ArtifactError)
		scratch.write('copy/closure.json', '{}')
		expect(() => verifyArtifactClosure(closure)).toThrow(/membership/)
		verifyArtifactClosure(closure, true)
		scratch.write('copy/other.json', '{}')
		expect(() => verifyArtifactClosure(closure, true)).toThrow(/membership/)
	} finally {
		await destroyScratch(scratch)
	}
})

it('fills a buffer from the file position it continues at and returns only the bytes before an early end of file', async () => {
	const scratch = createScratch()
	try {
		const descriptor = openSync(scratch.write('bytes.bin', 'abcdef'), 'r')
		try {
			const whole = Buffer.alloc(6)
			expect(readArtifactBytes(descriptor, whole)).toBe(whole)
			expect(whole.toString()).toBe('abcdef')
			const resumed = Buffer.alloc(6)
			expect(readArtifactBytes(descriptor, resumed, 4)).toBe(resumed)
			expect(resumed.subarray(0, 4)).toEqual(Buffer.alloc(4))
			expect(resumed.subarray(4).toString()).toBe('ef')
			expect(readArtifactBytes(descriptor, Buffer.alloc(0)).length).toBe(0)
			const short = readArtifactBytes(descriptor, Buffer.alloc(8))
			expect(short.length).toBe(6)
			expect(short.toString()).toBe('abcdef')
		} finally {
			closeSync(descriptor)
		}
	} finally {
		await destroyScratch(scratch)
	}
})

it('iterates the remaining entries of a directory handle lazily and ends at the last entry', async () => {
	const scratch = createScratch()
	try {
		scratch.write('listing/a.ts', '')
		scratch.write('listing/b.ts', '')
		scratch.write('listing/c.ts', '')
		const handle = opendirSync(scratch.ensure('listing'))
		try {
			const entries = iterateArtifactEntries(handle)
			const first = entries.next()
			if (first.done === true) throw new Error('Missing first directory entry')
			const rest = [...entries]
			expect([first.value, ...rest].map((entry) => entry.name).sort()).toEqual([
				'a.ts',
				'b.ts',
				'c.ts',
			])
			expect(rest).toHaveLength(2)
			expect([...iterateArtifactEntries(handle)]).toEqual([])
		} finally {
			handle.closeSync()
		}
	} finally {
		await destroyScratch(scratch)
	}
})

it('reads canonical bounded bytes and checks identities against an independent digest', async () => {
	const scratch = createScratch()
	try {
		const path = scratch.write('entry.js', 'abc')
		expect(readArtifact(path).digest).toBe(
			'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
		)
		expect(readArtifact(path).size).toBe(3)
		expect(Buffer.from(readArtifact(path).source).toString()).toBe('abc')
		expect(() => readArtifact(path, 2)).toThrow(/byte limit/)
		expect(() => readArtifact(path, Number.NaN)).toThrow(/byte budget/)
		expect(() => readArtifact('relative.js')).toThrow(/canonical regular file/)
		expect(() => readArtifact(scratch.path)).toThrow(/canonical regular file/)
		expect(isArtifactError(new ArtifactError('refusal'))).toBe(true)
		expect(isArtifactError(new Error('other'))).toBe(false)
	} finally {
		await destroyScratch(scratch)
	}
})
