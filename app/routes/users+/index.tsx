import { json, redirect, type LoaderFunctionArgs } from '@remix-run/node'
import { Link, useLoaderData } from '@remix-run/react'
import { z } from 'zod'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { ErrorList } from '#app/components/forms.tsx'
import { SearchBar } from '#app/components/search-bar.tsx'
import { prisma } from '#app/utils/db.server.ts'
import { cn, getUserImgSrc, useDelayedIsPending } from '#app/utils/misc.tsx'
import "#app/styles/users.scss"

const UserSearchResultSchema = z.object({
	id: z.string(),
	username: z.string(),
	name: z.string().nullable(),
	imageId: z.string().nullable(),
})

const UserSearchResultsSchema = z.array(UserSearchResultSchema)

export async function loader({ request }: LoaderFunctionArgs) {
	const searchTerm = new URL(request.url).searchParams.get('search')
	if (searchTerm === '') {
		return redirect('/users')
	}

	const like = `%${searchTerm ?? ''}%`
	const rawUsers = await prisma.$queryRaw`
		SELECT User.id, User.username, User.name, UserImage.id AS imageId
		FROM User
		LEFT JOIN UserImage ON User.id = UserImage.userId
		WHERE User.username LIKE ${like}
		ORDER BY (
			SELECT Note.updatedAt
			FROM Note
			WHERE Note.ownerId = User.id
			ORDER BY Note.updatedAt DESC
			LIMIT 1
		) DESC
		LIMIT 50
	`

	const result = UserSearchResultsSchema.safeParse(rawUsers)
	if (!result.success) {
		return json({ status: 'error', error: result.error.message } as const, {
			status: 400,
		})
	}
	return json({ status: 'idle', users: result.data } as const)
}

export default function UsersRoute() {
	const data = useLoaderData<typeof loader>()
	const isPending = useDelayedIsPending({
		formMethod: 'GET',
		formAction: '/users',
	})

	if (data.status === 'error') {
		console.error(data.error)
	}

	return (
    <main className="users">
      <div className="users-main">
        <h1 className="users-header">Users</h1>
        <div className="users-search">
          <SearchBar status={data.status} autoFocus autoSubmit />
        </div>
        <main>
          {data.status === 'idle' ? (
            data.users.length ? (
              <ul
                className={cn(
                  'users-list',
                  { 'opacity-50': isPending },
                )}
              >
                {data.users.map(user => (
                  <li key={user.id}>
                    <Link
                      to={user.username}
                      className="users-item"
                    >
                      <img
                        alt={user.username}
                        src={getUserImgSrc(user.imageId)}
                        className="users-image"
                      />
                      <span className="users-name">
                        {user.username}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No users found</p>
            )
          ) : data.status === 'error' ? (
            <ErrorList errors={['There was an error parsing the results']} />
          ) : null}
        </main>
      </div>
    </main>
	)
}

export function ErrorBoundary() {
	return <GeneralErrorBoundary />
}
