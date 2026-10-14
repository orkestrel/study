import { defineConfig } from 'vite'
import { resolveExternal } from '../helpers.js'
import { peers, srcBin } from '../../vite.config.ts'

// The `scaffold` executable build — a single ESM lib file, no declarations (an
// executable ships no types), with the `#!/usr/bin/env node` shebang re-emitted through
// `output.banner` (rolldown strips shebangs from source during bundling), and
// `output.paths` rewriting the externalized `@src/*` specifiers to the built sibling
// src environments (relative to `dist/bin/`), so the emitted bin resolves at runtime.
export default defineConfig(
	srcBin({
		build: {
			rolldownOptions: {
				external: (id: string) =>
					id.startsWith('@src/') || resolveExternal(id, { peers, refused: [], siblings: [] }),
				output: {
					banner: '#!/usr/bin/env node',
					paths: {
						'@src/core': '../src/core/index.js',
						'@src/server': '../src/server/index.js',
					},
				},
			},
		},
	}),
)
