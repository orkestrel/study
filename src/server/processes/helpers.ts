import type { StudyFailure, StudyProfile } from '../../core/types.js'
import type { JSONValue } from '@orkestrel/contract'
import type { ChildProcess } from 'node:child_process'
import { canonicalStringify, isJSONValue, isRecord } from '@orkestrel/contract'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { StudyError } from '../../core/errors.js'
import { hashStudyBytes } from '../helpers.js'
import { STUDY_DRAIN_DURATION } from './constants.js'

/** Projects optional domain fields into the JSON wire representation.
 * @param value - An owned domain value with optional undefined fields.
 * @returns A JSON-compatible snapshot.
 * @example Project a wire value
 * ```ts
 * import { toStudyWire } from '@orkestrel/study/server'
 *
 * toStudyWire({ state: 'ready', failure: undefined }) // { state: 'ready' }
 * ```
 */
export function toStudyWire(value: unknown): JSONValue {
	const parsed: unknown = JSON.parse(JSON.stringify(value))
	if (!isJSONValue(parsed)) throw new StudyError('FAULT', 'Invalid study wire value')
	return parsed
}

/** Creates attributable protocol infrastructure failure.
 * @param message - The refused operation or broken boundary.
 * @returns A domain failure that never awards task credit.
 */
export function createStudyProcessFailure(message: string): StudyFailure {
	return { cause: 'infrastructure', message, role: undefined }
}

/** Binds the canonical fully resolved execution profile carried over IPC.
 * @param profile - The resolved execution settings, with optional absent leaves.
 * @returns The SHA256 digest of the canonical JSON wire representation.
 */
export function computeStudyProfileDigest(profile: StudyProfile): string {
	const encoded = canonicalStringify(toStudyWire(profile))
	if (encoded === undefined) throw new StudyError('CONFIG', 'Study profile is not JSON-compatible')
	return hashStudyBytes(encoded)
}

/** Collects the executable entries a profile selects, each canonical path once.
 * @param profile - The resolved execution profile.
 * @returns The agent, subject, and provider entries without repeating a shared entry.
 * @remarks The declared roles stay separate in the profile; only capture and loading deduplicate.
 */
export function collectStudyEntries(profile: StudyProfile): readonly string[] {
	return [
		...new Set([
			profile.agent,
			profile.subject,
			...(profile.provider === undefined ? [] : [profile.provider.entry]),
		]),
	]
}

/** Computes the instrument identity binding trusted runtime bytes to the adapter inventory.
 * @param entry - The SHA-256 identity of the trusted runtime entry bytes.
 * @param inventory - The captured adapter inventory digest.
 * @returns The identity that validation, grading, and trial children must share.
 */
export function computeStudyInstrumentDigest(entry: string, inventory: string): string {
	return hashStudyBytes(JSON.stringify([entry, inventory]))
}

/** Resolves the actual host package from its trusted executable entry.
 * @param entry - The runtime's own executable, never a consumer-supplied module.
 * @returns The canonical study package root.
 */
export function resolveStudyInstrument(entry: string): string {
	const root = collectStudyAncestors(dirname(realpathSync(entry))).find((directory) => {
		const manifest = join(directory, 'package.json')
		if (!existsSync(manifest)) return false
		const value: unknown = JSON.parse(readFileSync(manifest, 'utf8'))
		return isRecord(value) && value.name === '@orkestrel/study'
	})
	if (root === undefined) throw new StudyError('CONFIG', 'Cannot locate the study runtime package')
	return root
}

/** Collects a directory and each of its ancestors up to the filesystem root, nearest first.
 * @param directory - The absolute directory to start from.
 * @returns The directory followed by every parent directory, ending at the root.
 */
export function collectStudyAncestors(directory: string): readonly string[] {
	const parent = dirname(directory)
	return parent === directory ? [directory] : [directory, ...collectStudyAncestors(parent)]
}

/** Refuses a profile that omits the actual host runtime's declared dependency bytes.
 * @param instrument - The canonical package owning the trusted runtime entry.
 * @param roots - Explicitly admitted package roots, including the instrument.
 */
export function validateStudyRuntime(instrument: string, roots: readonly string[]): void {
	const pending = [instrument]
	const visited = new Set<string>()
	while (pending.length > 0) {
		const root = pending.pop()
		if (root === undefined || visited.has(root)) continue
		visited.add(root)
		if (!roots.includes(root))
			throw new StudyError('CONFIG', `Profile roots omit a runtime dependency: ${root}`)
		const manifest = join(root, 'package.json')
		const value: unknown = JSON.parse(readFileSync(manifest, 'utf8'))
		if (!isRecord(value) || value.dependencies === undefined) continue
		if (!isRecord(value.dependencies))
			throw new StudyError('CONFIG', 'Runtime dependency declarations are invalid')
		const resolver = createRequire(manifest)
		for (const dependency of Object.keys(value.dependencies))
			pending.push(dirname(realpathSync(resolver.resolve(`${dependency}/package.json`))))
	}
}

/** Releases inherited output handles a bounded time after native exit.
 * @param child - A newly spawned child, subscribed before native exit.
 * @remarks A descendant that outlives an exited root is outside discoverable-tree cleanup; this only stops the parent from waiting on its pipes.
 */
export function drainStudyChild(child: ChildProcess): void {
	const closed = new AbortController()
	child.once('exit', () => {
		// A close before the allowance ends aborts the wait, which is the only rejection it can have.
		void delay(STUDY_DRAIN_DURATION, undefined, { signal: closed.signal }).then(
			() => {
				child.stdout?.destroy()
				child.stderr?.destroy()
			},
			() => undefined,
		)
	})
	child.once('close', () => closed.abort())
}

/** Terminates the recorded native process tree under a finite cleanup allowance.
 * @param child - The exclusively owned child process.
 */
export function terminateStudyChild(child: ChildProcess): void {
	if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return
	try {
		if (process.platform === 'win32')
			execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
				windowsHide: true,
				timeout: 2000,
				stdio: 'ignore',
			})
		else {
			const rows = execFileSync('ps', ['-eo', 'pid=,ppid='], {
				timeout: 2000,
				encoding: 'utf8',
				maxBuffer: 1024 * 1024,
			})
				.trim()
				.split(/\r\n|\n/)
				.map((row) => row.trim().split(/\s+/).map(Number))
			const descendants = new Set([child.pid])
			// One pass per row bounds the depth of any parent chain the table can hold.
			rows.forEach(() => {
				for (const [pid, parent] of rows)
					if (pid !== undefined && parent !== undefined && descendants.has(parent))
						descendants.add(pid)
			})
			for (const pid of [...descendants].reverse()) {
				try {
					process.kill(pid, 'SIGKILL')
				} catch (error) {
					if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error
				}
			}
		}
	} catch (error) {
		try {
			process.kill(child.pid, 0)
		} catch (status) {
			if (status instanceof Error && 'code' in status && status.code === 'ESRCH') return
			throw status
		}
		if (child.exitCode === null && child.signalCode === null) {
			child.kill('SIGKILL')
			throw error
		}
	}
}
