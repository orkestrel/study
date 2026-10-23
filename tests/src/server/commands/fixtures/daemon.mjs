// This protocol fixture runs directly and as a preload without a TypeScript loader.
import { createServer } from 'node:http'
import { appendFileSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

if (process.argv[2] === 'sentinel' || process.argv[2] === 'runner') {
	process.stdout.write(String(process.pid) + '\n')
	setInterval(() => {}, 60000)
} else {
	const origin = new URL(`http://${process.env.OLLAMA_HOST}`)
	if (origin.hostname !== '127.0.0.1' || !origin.port || origin.port === '11434')
		throw new Error('A dedicated loopback port is required')
	writeFileSync(process.env.STUDY_DAEMON_PID, String(process.pid))
	const runner = spawn(process.execPath, [fileURLToPath(import.meta.url), 'runner'], {
		stdio: 'ignore',
		env: { ...process.env, NODE_OPTIONS: '' },
	})
	writeFileSync(process.env.STUDY_DAEMON_RUNNER, String(runner.pid))
	const server = createServer(async (request, response) => {
		const chunks = []
		for await (const chunk of request) chunks.push(chunk)
		const body = Buffer.concat(chunks).toString()
		const sidecars = existsSync(process.env.STUDY_DAEMON_EVIDENCE)
			? readdirSync(process.env.STUDY_DAEMON_EVIDENCE)
					.map((name) => join(process.env.STUDY_DAEMON_EVIDENCE, name, 'exchanges.jsonl'))
					.filter((path) => existsSync(path))
			: []
		const retained =
			request.url === '/api/generate' &&
			sidecars.some((path) => {
				const row = JSON.parse(
					readFileSync(path, 'utf8')
						.split(/\r\n|\n/)
						.filter(Boolean)
						.at(-1),
				)
				return (
					row.phase === 'attempt' &&
					row.stage === 'maintenance' &&
					Buffer.from(row.body, 'base64').toString() === body
				)
			})
		const positions = sidecars.flatMap((path) => {
			const rows = readFileSync(path, 'utf8')
				.split(/\r\n|\n/)
				.filter(Boolean)
				.map((line) => JSON.parse(line))
			const row = rows.at(-1)
			return row?.phase === 'attempt' &&
				row.path === request.url &&
				Buffer.from(row.body, 'base64').toString() === body
				? [{ trial: rows[0].trial, ordinal: row.ordinal, goal: row.goal, stage: row.stage }]
				: []
		})
		appendFileSync(
			process.env.STUDY_DAEMON_REQUESTS,
			JSON.stringify({ method: request.method, path: request.url, body, retained, positions }) +
				'\n',
		)
		response.setHeader('content-type', 'application/json')
		if (request.url === '/api/version')
			response.end(
				JSON.stringify({
					version:
						process.env.STUDY_DAEMON_MODE === 'start-failure' ? 'wrong-version' : 'fixture-version',
				}),
			)
		else if (request.url === '/api/tags')
			response.end(
				JSON.stringify({
					models: [
						{ name: 'model', digest: 'a'.repeat(64) },
						{ name: 'judge', digest: 'b'.repeat(64) },
					],
				}),
			)
		else if (request.url === '/api/show')
			response.end(
				JSON.stringify({
					model_info: { 'general.architecture': 'fixture', 'fixture.context_length': 8192 },
				}),
			)
		else if (request.url === '/api/generate') {
			if (process.env.STUDY_DAEMON_MODE === 'unload-failure')
				response.writeHead(500).end(JSON.stringify({ error: 'maintenance refused' }))
			else
				response.end(
					JSON.stringify({ model: JSON.parse(body).model, done: true, done_reason: 'unload' }),
				)
		} else if (process.env.STUDY_DAEMON_MODE === 'cancel') {
			// The test aborts after this request appears in the request log.
		} else if (process.env.STUDY_DAEMON_MODE === 'trial-failure')
			response.writeHead(500).end(JSON.stringify({ error: 'trial refused' }))
		else
			response.end(
				JSON.stringify({
					model: 'model',
					message: { role: 'assistant', content: 'Receipt retained.' },
					done: true,
					done_reason: 'stop',
					prompt_eval_count: 4,
					eval_count: 3,
				}) + '\n',
			)
	})
	server.listen(Number(origin.port), '127.0.0.1', () =>
		process.stderr.write(`Listening on 127.0.0.1:${origin.port} (version fixture-version)\n`),
	)
	await new Promise(() => {})
}
