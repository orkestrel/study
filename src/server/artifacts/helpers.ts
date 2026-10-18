import type { Dir, Dirent } from 'node:fs'
import type { ArtifactSource } from './types.js'
import { closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { hashStudyBytes } from '../helpers.js'
import { ARTIFACT_FILE_BYTES } from './constants.js'
import { ArtifactError } from './errors.js'

/** Fills a buffer from an open descriptor, one positioned read at a time.
 * @param descriptor - The open file descriptor to read.
 * @param target - The buffer to fill.
 * @param offset - The position in the file and the buffer to continue from; Default: 0.
 * @returns The bytes read, as the whole buffer when the file filled it or as its leading part when the file ended first.
 */
export function readArtifactBytes(descriptor: number, target: Buffer, offset = 0): Buffer {
	if (offset >= target.length) return target
	const count = readSync(descriptor, target, offset, target.length - offset, offset)
	return count === 0
		? target.subarray(0, offset)
		: readArtifactBytes(descriptor, target, offset + count)
}

/** Iterates the remaining entries of an open directory handle lazily, in read order.
 * @param handle - The open synchronous directory handle; the caller owns it and closes it.
 * @returns Each remaining entry until the handle reports the end. An entry is read only when the consumer asks for it, so a consumer that stops early leaves the rest unread.
 */
export function* iterateArtifactEntries(handle: Dir): Generator<Dirent, void> {
	for (;;) {
		const entry = handle.readSync()
		if (entry === null) return
		yield entry
	}
}

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
		const source = readArtifactBytes(descriptor, Buffer.alloc(before.size))
		if (source.length !== before.size)
			throw new ArtifactError(`Artifact file drifted while reading: ${path}`)
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
