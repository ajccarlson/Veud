import { createHash, randomBytes } from 'node:crypto'
import { type PrismaClient } from '@prisma/client'

const RECOVERY_CODE_COUNT = 10

export function normalizeRecoveryCode(code: string) {
	return code.replace(/[^a-z0-9]/gi, '').toUpperCase()
}

export function recoveryCodeHash(code: string) {
	return createHash('sha256').update(normalizeRecoveryCode(code)).digest('hex')
}

export function looksLikeRecoveryCode(code: string) {
	return /^[A-Z0-9]{16}$/.test(normalizeRecoveryCode(code))
}

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT) {
	return Array.from({ length: count }, () => {
		const compact = randomBytes(10)
			.toString('base64url')
			.replace(/[-_]/g, '')
			.toUpperCase()
			.padEnd(16, '0')
			.slice(0, 16)
		return compact.match(/.{1,4}/g)!.join('-')
	})
}

type RecoveryCodeClient = Pick<
	PrismaClient,
	'twoFactorRecoveryCode' | '$transaction'
>

export async function replaceRecoveryCodes(
	prisma: RecoveryCodeClient,
	userId: string,
) {
	const codes = generateRecoveryCodes()
	await prisma.$transaction([
		prisma.twoFactorRecoveryCode.deleteMany({ where: { userId } }),
		prisma.twoFactorRecoveryCode.createMany({
			data: codes.map(code => ({
				userId,
				codeHash: recoveryCodeHash(code),
			})),
		}),
	])
	return codes
}

export async function hasUnusedRecoveryCode(
	prisma: Pick<PrismaClient, 'twoFactorRecoveryCode'>,
	userId: string,
	code: string,
) {
	if (!looksLikeRecoveryCode(code)) return false
	return Boolean(
		await prisma.twoFactorRecoveryCode.findFirst({
			where: {
				userId,
				codeHash: recoveryCodeHash(code),
				usedAt: null,
			},
			select: { id: true },
		}),
	)
}

export async function consumeRecoveryCode(
	prisma: Pick<PrismaClient, 'twoFactorRecoveryCode'>,
	userId: string,
	code: string,
) {
	if (!looksLikeRecoveryCode(code)) return false
	const result = await prisma.twoFactorRecoveryCode.updateMany({
		where: {
			userId,
			codeHash: recoveryCodeHash(code),
			usedAt: null,
		},
		data: { usedAt: new Date() },
	})
	if (result.count !== 1) {
		throw new Error('Recovery code is invalid or has already been used.')
	}
	return true
}
