import { redirect } from "@remix-run/node"
import { invariantResponse } from '@epic-web/invariant'
import { prisma } from '#app/utils/db.server.ts'

export async function loader(params) {
  const currentUser = await prisma.User.findUnique({
    where: {
      username: params['params']['username'],
    },
  })

  invariantResponse(currentUser, 'User not found', { status: 404 })

  const listTypeData = await prisma.ListType.findFirst()

  invariantResponse(listTypeData, 'List type not found', { status: 404 })

  return redirect(`./${listTypeData.name}`, 303);
}
