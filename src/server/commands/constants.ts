/** Caps declared execution duration at the native supervisor's host ceiling. */
export const STUDY_COMMAND_DURATION = 86400000

/** Names the trusted command's independent offline predicate. */
export const STUDY_COMMAND_GRADER = 'consumer-adapter'

/** Defines the complete public CLI reference shared by help and grammar diagnostics. */
export const STUDY_COMMAND_HELP = `study check <study> [--profile <name>] [--closure <directory>]
study freeze <study> --profile <name> --to <directory>
study execute <study> [--profile <name>] [--out <path>] [--expected <sha256>] [--closure <directory>] [--replay <result> --prefix <JSON trial counts> --offline <true|false>]
study grade <result> --rubric <path>
study label <result> --grading <sha256> --labels <path>
study report <result> --grading <sha256>
study --help
study --version

Profiles default to local; freeze requires --profile. Flags require values and may appear only once.
Results default to tmp/studies/<result>; scratch also uses tmp/studies.
A result is its id under tmp/studies, a root-relative path, or an absolute path.
Relative paths, including --out, must stay inside the consumer working directory.
Output directories must be new; existing results are never overwritten.
--expected pins the fingerprint returned by check. --grading selects an exact grading.
--rubric selects independent criteria. --labels imports caller-supplied semantic labels.
--closure selects retained artifacts. Replay requires explicit prefix counts and offline behavior.
Success writes one JSON document; next contains suggested argv, never executed automatically.
check, freeze, grade, label and report have a fixed allowance of 60 seconds.
execute checks first, then uses the declared series duration plus 15 seconds for cleanup.
Exit codes: 0 success, 64 invalid input, 124 deadline, 130 interruption, 1 operational failure.
`
