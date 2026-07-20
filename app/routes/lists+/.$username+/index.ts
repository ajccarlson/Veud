import { redirect } from 'react-router'
import { invariantResponse } from '@epic-web/invariant'
import { prisma } from '#app/utils/db.server.ts'
import { type LoaderFunctionArgs } from 'react-router'

export async function loader({ params }: LoaderFunctionArgs) {
  const currentUser = await prisma.user.findUnique({
    where: {
      username: params['username'] as string,
    },
  })

  invariantResponse(currentUser, 'User not found', { status: 404 })

  const listTypeData = await prisma.listType.findFirst()

  invariantResponse(listTypeData, 'List type not found', { status: 404 })

  return redirect(`./${listTypeData.name}`, 303);
}
