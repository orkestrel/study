# @orkestrel/study

> Bounded comparative execution with captured artifacts and separate grading.

Study schedules declared populations, admits requests before dispatch, retains execution bytes, and grades sealed results independently. Consumer adapters supply domain behavior.

## Install

Install Study in your consumer workspace.

```sh
npm install --save-dev @orkestrel/study
```

Study requires Node.js 22.18.0 or later. TypeScript consumers of the server entry must also install `@types/node` because its declarations import `node:` modules. The core entry needs no Node.js types.

For the server declarations, add the type prerequisite.

```sh
npm install --save-dev @types/node
```

## Package entries

Import the entry for your execution environment. Each entry supports ESM import and CommonJS require.

Within one module format, the root and server entries share one `StudyError` class, so both `instanceof StudyError` and `isStudyError` recognize server errors. The ESM and CommonJS builds carry separate classes. Across module formats, recognize a server error with `isStudyError`; `instanceof StudyError` is false.

| Export     | Import                    | Provides                                                                                  |
| ---------- | ------------------------- | ----------------------------------------------------------------------------------------- |
| `.`        | `@orkestrel/study`        | Host-independent engine, contracts, guards, and parsers                                   |
| `./server` | `@orkestrel/study/server` | Custody, native workers, command classes, Agent instrumentation, and the Ollama transport |

## Run the study executable

The package installs the `study` executable. From your consumer workspace, invoke the local command through npm.

```sh
npm exec -- study --help
npm exec -- study --version
```

The `study --help` command prints the command reference. The `study --version` command prints the installed Study version. Use the operations for validation, execution, independent grading, label import, and reporting.

| Operation               | Command                                                                         |
| ----------------------- | ------------------------------------------------------------------------------- |
| Validate declarations   | `study check <study> [--profile <name>]`                                        |
| Execute a study         | `study execute <study> [--profile <name>] [--out <path>] [--expected <sha256>]` |
| Grade retained evidence | `study grade <result> --rubric <path>`                                          |
| Import semantic labels  | `study label <result> --grading <sha256> --labels <path>`                       |
| Report an exact grading | `study report <result> --grading <sha256>`                                      |

Declare a study at `studies/<name>/study.json`. Its rubric path resolves inside that study directory. Its `driver` field selects a bundle at `studies/<driver>/` containing the adapter module `index.ts`, scenario declarations at `scenarios/<scenario>.json`, and execution profiles at `profiles/<profile>.json`. The profile defaults to `local`.

Results default to `tmp/studies/<result>`. A result selector can be an identity under that directory, a root-relative path, or an absolute path. Relative paths must stay inside the consumer workspace. Output directories must be absent before execution.

Read the exit code to distinguish outcomes.

| Exit code | Meaning                                             |
| --------- | --------------------------------------------------- |
| 0         | Success                                             |
| 64        | Invalid input, including a missing declaration file |
| 124       | Deadline                                            |
| 130       | Interruption                                        |
| 1         | Operational failure, including a missing result     |

## Documentation

For the contracts, declaration layout, and executable behavior, see the [Study guide](guides/study.md). For the guide map, see the [guide index](guides/README.md).

## Development

Run the package checks and read-only guide proof.

```sh
npm test
npm run test:guides
```
