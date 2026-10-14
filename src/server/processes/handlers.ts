import type { ChildProcess } from 'node:child_process'
import { execFileSync } from 'node:child_process'
import { StudyControl, StudyScope } from '../../core/engines/index.js'

/** Bounds process handshake or cleanup work independently of cancelled execution.
 * @param work - Already observed asynchronous host work.
 * @param duration - Finite deadline in milliseconds.
 * @returns The completed work or a deadline rejection.
 */
export async function awaitStudyProcess<T>(work: PromiseLike<T>, duration: number): Promise<T> {
	const control = new StudyControl()
	const scope = new StudyScope({
		limit: { duration, calls: 1, tokens: 1, bytes: 1 },
		control,
		label: 'Process lifecycle',
	})
	try {
		const result = await control.wait(work)
		scope.check()
		return result
	} finally {
		scope.close()
		control.close()
	}
}

/** Terminates the recorded native process tree under a finite cleanup allowance.
 * @param child - The exclusively owned child process.
 */
export function terminateStudyChild(child: ChildProcess): void {
	if (child.pid === undefined) return
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
			for (let index = 0; index < rows.length; index++)
				for (const [pid, parent] of rows)
					if (pid !== undefined && parent !== undefined && descendants.has(parent))
						descendants.add(pid)
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
