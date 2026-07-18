import { requireUserId } from './auth.server.ts'
import { prisma } from './db.server.ts'
import { type PermissionString, parsePermissionString } from './user.ts'

export async function requireUserWithPermission(
	request: Request,
	permission: PermissionString,
	{ url }: { url?: URL } = {},
) {
	const userId = await requireUserId(request, { url })
	const permissionData = parsePermissionString(permission)
	const user = await prisma.user.findFirst({
		select: { id: true },
		where: {
			id: userId,
			roles: {
				some: {
					permissions: {
						some: {
							...permissionData,
							access: permissionData.access
								? { in: permissionData.access }
								: undefined,
						},
					},
				},
			},
		},
	})
	if (!user) {
		throw Response.json(
			{
				error: 'Unauthorized',
				requiredPermission: permissionData,
				message: `Unauthorized: required permissions: ${permission}`,
			},
			{ status: 403 },
		)
	}
	return user.id
}

export async function requireUserWithRole(
	request: Request,
	name: string,
	{ url }: { url?: URL } = {},
) {
	const userId = await requireUserId(request, { url })
	const user = await prisma.user.findFirst({
		select: { id: true },
		where: { id: userId, roles: { some: { name } } },
	})
	if (!user) {
		throw Response.json(
			{
				error: 'Unauthorized',
				requiredRole: name,
				message: `Unauthorized: required role: ${name}`,
			},
			{ status: 403 },
		)
	}
	return user.id
}
