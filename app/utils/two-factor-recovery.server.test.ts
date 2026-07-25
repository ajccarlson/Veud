import { expect, test } from 'vitest'
import { prisma } from './db.server.ts'
import {
	consumeRecoveryCode,
	generateRecoveryCodes,
	hasUnusedRecoveryCode,
	normalizeRecoveryCode,
	recoveryCodeHash,
	replaceRecoveryCodes,
} from './two-factor-recovery.server.ts'

test('generates printable high-entropy recovery codes with stable hashes', () => {
	const codes = generateRecoveryCodes()
	expect(codes).toHaveLength(10)
	expect(new Set(codes).size).toBe(10)
	expect(
		codes.every(code => /^[A-Z0-9]{4}(?:-[A-Z0-9]{4}){3}$/.test(code)),
	).toBe(true)
	expect(recoveryCodeHash(codes[0]!)).toBe(
		recoveryCodeHash(normalizeRecoveryCode(codes[0]!).toLowerCase()),
	)
})

test('stores only hashes and consumes each recovery code once', async () => {
	const user = await prisma.user.create({
		data: {
			email: 'recovery-codes@example.com',
			username: 'recovery_codes',
		},
	})
	const codes = await replaceRecoveryCodes(prisma, user.id)
	const stored = await prisma.twoFactorRecoveryCode.findMany({
		where: { userId: user.id },
	})
	expect(stored).toHaveLength(10)
	expect(stored.some(item => codes.includes(item.codeHash))).toBe(false)
	expect(await hasUnusedRecoveryCode(prisma, user.id, codes[0]!)).toBe(true)
	expect(await consumeRecoveryCode(prisma, user.id, codes[0]!)).toBe(true)
	expect(await hasUnusedRecoveryCode(prisma, user.id, codes[0]!)).toBe(false)
	await expect(consumeRecoveryCode(prisma, user.id, codes[0]!)).rejects.toThrow(
		/already been used/,
	)
})
