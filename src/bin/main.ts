import { fileURLToPath } from 'node:url'
import { StudyCLI } from '@src/server'

process.exitCode = await new StudyCLI({
	root: process.cwd(),
	entry: fileURLToPath(import.meta.url),
}).execute(process.argv.slice(2))
