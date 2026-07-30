// Rescue guardian for exclusive PostgreSQL restores.
//
// The exclusive restore session sets the target database to CONNECTION
// LIMIT 1 and occupies that single slot. If the owning process is killed
// (SIGKILL), the crash-bound psql client dies but PostgreSQL can retain the
// restore backend until a long-running statement notices the disconnect, so
// an immediate retry receives "too many connections".
//
// This guardian holds one additional backend that is connected BEFORE the
// limit drops to 1 (existing sessions are unaffected by the limit) and is
// explicitly excluded from the restore session's exclusivity assertions. It
// is spawned crash-bound (setpriv --pdeathsig SIGTERM), so owner death
// delivers SIGTERM here; the guardian then terminates every other backend on
// the database with a bounded wait, deliberately RETAINS the connection
// limit of 1, and exits — leaving exactly one free slot for a retry.
//
// Protocol:
//   stdout: "VEUD_GUARDIAN_BACKEND:<pid>" once the session is established.
//   stdin:  "release\n" (or end-of-stream) requests a clean, termination-free
//           shutdown after a successful or self-recovered restore.
import { spawn } from 'node:child_process'
import process from 'node:process'
import readline from 'node:readline'

const TERMINATION_WAIT_ATTEMPTS = 40
const TERMINATION_WAIT_INTERVAL_SECONDS = 0.25
// Must outlast the worst-case termination loop plus one slow round trip.
const PSQL_EXIT_TIMEOUT_MS =
	Math.ceil(
		TERMINATION_WAIT_ATTEMPTS * TERMINATION_WAIT_INTERVAL_SECONDS * 1000 * 2,
	) + 10_000

const psqlBinary = process.env.VEUD_GUARDIAN_PSQL
if (!psqlBinary || psqlBinary.includes('\u0000')) {
	process.stderr.write('Guardian requires VEUD_GUARDIAN_PSQL\n')
	process.exit(2)
}

// Crash-bound: if the guardian is SIGKILLed (start/release timeout) its psql
// must not outlive it holding a backend slot.
const psql = spawn(
	'/usr/bin/setpriv',
	[
		'--pdeathsig',
		'SIGTERM',
		'--',
		psqlBinary,
		'--no-psqlrc',
		'--quiet',
		'--tuples-only',
		'--no-align',
		// Without this a failed termination (for example a backend owned by
		// another role) is swallowed and the guardian would exit reporting a
		// recovery it never performed.
		'--set',
		'ON_ERROR_STOP=1',
	],
	{ stdio: ['pipe', 'pipe', 'inherit'] },
)

let shuttingDown = false

// `propagate` makes the guardian's exit status carry psql's: a rescue that
// could not free the slot (RAISE EXCEPTION under ON_ERROR_STOP) must never be
// byte-identical to one that succeeded.
function exitSoon(code, { propagate = false } = {}) {
	const resolveCode = psqlCode =>
		propagate && psqlCode !== 0 ? (psqlCode ?? 2) : code
	// Never outlive a broken pipeline; the parent enforces its own bound too.
	setTimeout(
		() => process.exit(propagate ? 2 : code),
		PSQL_EXIT_TIMEOUT_MS,
	).unref()
	psql.once('close', psqlCode => process.exit(resolveCode(psqlCode)))
	if (psql.exitCode !== null || psql.signalCode !== null) {
		process.exit(resolveCode(psql.exitCode ?? 2))
	}
}

psql.once('error', () => process.exit(2))
psql.once('close', code => {
	if (!shuttingDown) process.exit(code === 0 ? 0 : 2)
})
psql.stdin.on('error', () => {})

psql.stdin.write(
	"SELECT 'VEUD_GUARDIAN_BACKEND:' || pg_catalog.pg_backend_pid();\n",
)

const psqlLines = readline.createInterface({ input: psql.stdout })
psqlLines.on('line', line => {
	if (/^VEUD_GUARDIAN_BACKEND:[0-9]+$/.test(line.trim())) {
		process.stdout.write(`${line.trim()}\n`)
	}
})

function releaseCleanly() {
	if (shuttingDown) return
	shuttingDown = true
	if (!psql.stdin.destroyed) psql.stdin.end('\\q\n')
	exitSoon(0)
}

function terminateOtherBackends() {
	if (shuttingDown) return
	shuttingDown = true
	// Bounded, single-connection recovery: terminate every other backend on
	// this database, wait for the slots to actually clear, keep CONNECTION
	// LIMIT 1 in place, and exit so exactly one retry slot exists.
	if (!psql.stdin.destroyed) {
		psql.stdin.end(
			[
				'SELECT pg_catalog.pg_terminate_backend(activity.pid)',
				'FROM pg_catalog.pg_stat_activity AS activity',
				'WHERE activity.datname = pg_catalog.current_database()',
				'  AND activity.pid <> pg_catalog.pg_backend_pid();',
				'DO $veud_guardian$',
				'DECLARE remaining integer;',
				'BEGIN',
				`\tFOR attempt IN 1..${TERMINATION_WAIT_ATTEMPTS} LOOP`,
				'\t\tSELECT count(*) INTO remaining',
				'\t\tFROM pg_catalog.pg_stat_activity AS activity',
				'\t\tWHERE activity.datname = pg_catalog.current_database()',
				'\t\t  AND activity.pid <> pg_catalog.pg_backend_pid();',
				'\t\tEXIT WHEN remaining = 0;',
				'\t\tPERFORM pg_catalog.pg_terminate_backend(activity.pid)',
				'\t\tFROM pg_catalog.pg_stat_activity AS activity',
				'\t\tWHERE activity.datname = pg_catalog.current_database()',
				'\t\t  AND activity.pid <> pg_catalog.pg_backend_pid();',
				`\t\tPERFORM pg_catalog.pg_sleep(${TERMINATION_WAIT_INTERVAL_SECONDS});`,
				'\tEND LOOP;',
				'\tIF remaining <> 0 THEN',
				// Fail loudly: a guardian that could not free the slot must never
				// look like one that did.
				"\t\tRAISE EXCEPTION 'veud guardian could not free the restore slot';",
				'\tEND IF;',
				'END',
				'$veud_guardian$;',
				'\\q',
				'',
			].join('\n'),
		)
	}
	exitSoon(0, { propagate: true })
}

process.on('SIGTERM', terminateOtherBackends)
process.on('SIGINT', terminateOtherBackends)
process.on('SIGHUP', terminateOtherBackends)

const ownerLines = readline.createInterface({ input: process.stdin })
ownerLines.on('line', line => {
	if (line.trim() === 'release') releaseCleanly()
})
process.stdin.on('end', () => {
	// Owner stream ending without a release request means the owner died in a
	// way that closed our stdin (or forgot us): recover conservatively.
	if (!shuttingDown) terminateOtherBackends()
})
process.stdin.on('error', () => {
	// A transient pipe error is not proof the owner died, and terminating here
	// would kill a legitimately running restore. Release instead.
	if (!shuttingDown) releaseCleanly()
})
