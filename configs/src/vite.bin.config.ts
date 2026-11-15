import { defineConfig } from 'vite'
import { declarationRollup, resolveExternal, rewriteSourceSpecifier } from '../helpers.js'
import { peers, resolveWorkspacePath, srcBin } from '../../vite.config.ts'

// One ES file per `src/bin` module. Rolldown strips a source shebang, so `main` alone takes
// the `#!/usr/bin/env node` banner; every other module ships its rolled-up declaration.
// `output.paths` and the declaration rewrite point each external `@src/*` specifier at the
// built environment beside `dist/bin/`.
export default defineConfig(
	srcBin({
		plugins: [
			declarationRollup({
				project: resolveWorkspacePath('configs/src/tsconfig.bin.json'),
				entries: [],
				rewrite: rewriteSourceSpecifier,
			}),
		],
		build: {
			rolldownOptions: {
				external: (id: string) =>
					id.startsWith('@src/') || resolveExternal(id, { peers, refused: [], siblings: [] }),
				output: {
					banner: (chunk) => (chunk.name === 'main' ? '#!/usr/bin/env node' : ''),
					paths: {
						'@src/core': '../src/core/index.js',
						'@src/server': '../src/server/index.js',
					},
				},
			},
		},
	}),
)
