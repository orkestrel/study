import type { ArtifactSource } from './types.js'
import { closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { hashStudyBytes } from '../helpers.js'
import { ARTIFACT_FILE_BYTES } from './constants.js'
import { ArtifactError } from './errors.js'

/** Reads a bounded regular file only through its canonical absolute path.
 * @param path - The absolute path to inspect.
 * @param maximum - The remaining capture budget; Default: 16 MiB.
 * @returns Captured bytes with their identity.
 * @throws Thrown when the path is linked, noncanonical, oversized, or changes while read.
 */
export function readArtifact(path: string, maximum = ARTIFACT_FILE_BYTES): ArtifactSource {
	if (
		!Number.isSafeInteger(maximum) ||
		maximum < 0 ||
		!isAbsolute(path) ||
		resolve(path) !== path ||
		realpathSync(path) !== path ||
		!lstatSync(path).isFile()
	) {
		throw new ArtifactError(`Artifact requires a canonical regular file and byte budget: ${path}`)
	}
	const descriptor = openSync(path, 'r')
	try {
		const before = fstatSync(descriptor)
		if (!before.isFile() || before.size > Math.min(maximum, ARTIFACT_FILE_BYTES))
			throw new ArtifactError(`Artifact byte limit exceeded: ${path}`)
		const source = Buffer.alloc(before.size)
		let offset = 0
		while (offset < source.length) {
			const count = readSync(descriptor, source, offset, source.length - offset, offset)
			if (count === 0) throw new ArtifactError(`Artifact file drifted while reading: ${path}`)
			offset += count
		}
		const after = fstatSync(descriptor)
		if (
			before.size !== after.size ||
			before.mtimeMs !== after.mtimeMs ||
			before.ctimeMs !== after.ctimeMs ||
			realpathSync(path) !== path ||
			!lstatSync(path).isFile()
		)
			throw new ArtifactError(`Artifact file drifted while reading: ${path}`)
		return { path, digest: hashStudyBytes(source), size: source.byteLength, source }
	} finally {
		closeSync(descriptor)
	}
}
