import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { acquireBackupLock } from './backup-single-flight.mjs'

let tempDir
let lockPath

beforeEach(() => {
	tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'veud-lock-test-'))
	lockPath = path.join(tempDir, 'nested', 'backup.lock')
})

afterEach(() => {
	fs.rmSync(tempDir, { recursive: true, force: true })
})

test('the first run takes the lock and records itself', () => {
	const lock = acquireBackupLock(lockPath, { pid: 1234 })
	expect(lock.acquired).toBe(true)
	expect(fs.readFileSync(lockPath, 'utf8')).toBe('1234')
	lock.release()
	expect(fs.existsSync(lockPath)).toBe(false)
})

test('a second run is turned away while the first is alive', () => {
	const first = acquireBackupLock(lockPath, { pid: 1234 })
	expect(first.acquired).toBe(true)
	const second = acquireBackupLock(lockPath, {
		pid: 5678,
		isRunning: pid => pid === 1234,
	})
	expect(second.acquired).toBe(false)
	expect(second.owner).toBe(1234)
	// And it must not have stolen the lock on its way out.
	expect(fs.readFileSync(lockPath, 'utf8')).toBe('1234')
})

test('a lock left by a dead process is reclaimed, not honoured forever', () => {
	// Otherwise one killed backup stops every future backup, silently.
	fs.mkdirSync(path.dirname(lockPath), { recursive: true })
	fs.writeFileSync(lockPath, '4242')
	const lock = acquireBackupLock(lockPath, {
		pid: 99,
		isRunning: () => false,
	})
	expect(lock.acquired).toBe(true)
	expect(fs.readFileSync(lockPath, 'utf8')).toBe('99')
})

test('a fresh unreadable lock is honoured, an old one is reclaimed', () => {
	// This version cannot write an unattributable lock — the pid is published
	// atomically — so one can only come from an older build or a torn write.
	// Reclaiming immediately could steal from a live writer; honouring forever
	// would stop every future backup silently. Age decides.
	fs.mkdirSync(path.dirname(lockPath), { recursive: true })
	fs.writeFileSync(lockPath, 'not-a-pid')

	const fresh = acquireBackupLock(lockPath, {
		pid: 7,
		isRunning: () => true,
		lockAge: () => Date.now(),
	})
	expect(fresh.acquired).toBe(false)

	const stale = acquireBackupLock(lockPath, {
		pid: 7,
		isRunning: () => true,
		lockAge: () => Date.now() - 3 * 60 * 60 * 1_000,
	})
	expect(stale.acquired).toBe(true)
	expect(fs.readFileSync(lockPath, 'utf8')).toBe('7')
})

test('the lock is never visible without its owner inside it', () => {
	// openSync('wx') then writeSync left a window where the file existed and was
	// empty, and a reader parsing '' gets 0 — which failed the `> 0` check and
	// reclaimed a live owner's lock as debris.
	const lock = acquireBackupLock(lockPath, { pid: 4321 })
	expect(lock.acquired).toBe(true)
	expect(fs.readFileSync(lockPath, 'utf8')).toBe('4321')
	// No staging file is left behind.
	const strays = fs
		.readdirSync(path.dirname(lockPath))
		.filter(name => name.includes('staged'))
	expect(strays).toEqual([])
})

test('releasing never removes another process lock', () => {
	const lock = acquireBackupLock(lockPath, { pid: 1234 })
	// Another run reclaimed it in the meantime.
	fs.writeFileSync(lockPath, '5678')
	lock.release()
	expect(fs.existsSync(lockPath)).toBe(true)
	expect(fs.readFileSync(lockPath, 'utf8')).toBe('5678')
})

test('releasing an already-gone lock is not an error', () => {
	const lock = acquireBackupLock(lockPath, { pid: 1234 })
	fs.rmSync(lockPath, { force: true })
	expect(() => lock.release()).not.toThrow()
})
