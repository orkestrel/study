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
