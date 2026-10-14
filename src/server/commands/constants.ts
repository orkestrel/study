/** Caps declared execution duration at the native supervisor's host ceiling. */
export const STUDY_COMMAND_DURATION = 86400000

/** Fixes the trusted command's independent offline predicate version. */
export const STUDY_COMMAND_GRADER = 'consumer-adapter-v1'

/** Defines the complete public CLI reference shared by help and grammar diagnostics. */
export const STUDY_COMMAND_HELP = `study check <study> [--profile <name>]
study execute <study> [--profile <name>] [--out <path>] [--expected <sha256>]
study grade <result> --rubric <path>
study label <result> --grading <sha256> --labels <path>
study report <result> --grading <sha256>
study --help

Profiles default to local. Flags require values and may appear only once.
Results default to tmp/studies/<result>; scratch also uses tmp/studies.
A result is its id under tmp/studies, a root-relative path, or an absolute path.
Relative paths, including --out, must stay inside the consumer working directory.
Output directories must be new; existing results are never overwritten.
--expected pins the fingerprint returned by check. --grading selects an exact grading.
--rubric selects independent criteria. --labels imports caller-supplied semantic labels.
Success writes one JSON document; next contains suggested argv, never executed automatically.
check, grade, label and report have a fixed allowance of 60 seconds.
execute checks first, then uses the declared series duration plus 15 seconds for cleanup.
Exit codes: 0 success, 64 invalid input, 124 deadline, 130 interruption, 1 operational failure.
`
