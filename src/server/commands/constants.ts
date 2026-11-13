/** Caps declared execution duration at the native supervisor's host ceiling. */
export const STUDY_COMMAND_DURATION = 86400000

/** Names the trusted command's independent offline predicate. */
export const STUDY_COMMAND_GRADER = 'consumer-adapter'

/** Names the evidence event whose row a seeded execution hands its trial at open. */
export const STUDY_CHECKPOINT_EVENT = 'checkpoint'

/** Defines the complete public CLI reference shared by help and grammar diagnostics. */
export const STUDY_COMMAND_HELP = `study check <study> [--profile <name>] [--closure <directory>] [--extend <result>] [--trial <name>] [--goals <first>..<last>] [--seed <result>:<trial>:<goal>]
study freeze <study> --profile <name> --to <directory>
study execute <study> [--profile <name>] [--out <path>] [--expected <sha256>] [--closure <directory>] [--extend <result> | --replay <result> --prefix <JSON trial counts> --offline <true|false> | --replay <result> --roles <JSON roles> --offline <true|false>] [--trial <name>] [--goals <first>..<last>] [--seed <result>:<trial>:<goal>]
study grade <result> --rubric <path>
study label <result> --assessment <sha256> --labels <path>
study report <result> --assessment <sha256>
study progress <result> [--from <goal>]
study --help
study --version

Profiles default to local; freeze requires --profile. Flags require values and may appear only once.
Results default to tmp/studies/<result>; scratch also uses tmp/studies.
A result is its id under tmp/studies, a root-relative path, or an absolute path.
Relative paths, including --out, must stay inside the consumer working directory.
Output directories must be new; existing results are never overwritten.
--expected pins the fingerprint returned by check. --assessment selects an exact assessment.
--rubric selects independent criteria. --labels imports caller-supplied semantic labels.
--closure selects retained artifacts. Replay requires explicit prefix counts or roles, and offline behavior.
--roles serves a listed role's request whose path, method, and body bytes equal a recorded attempt's.
--extend continues a sealed open recording with further goals; the profile can omit a daemon.
check carries --extend into next and binds the ancestor seal into its fingerprint.
check binds --trial, --goals, and --seed into its fingerprint and carries them into next.
Success writes one JSON document; next contains suggested argv, never executed automatically.
check, freeze, grade, label, report and progress have a fixed allowance of 60 seconds.
execute checks first, then uses the declared series duration plus 15 seconds for cleanup.
Exit codes: 0 success, 64 invalid input, 124 deadline, 130 interruption, 1 operational failure.
`
