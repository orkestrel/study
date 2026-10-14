import { fileURLToPath } from 'node:url'
import { StudyCLI } from '../server/launchers/StudyCLI.js'

process.exitCode = await new StudyCLI({
	root: process.cwd(),
	entry: fileURLToPath(import.meta.url),
}).execute(process.argv.slice(2))
