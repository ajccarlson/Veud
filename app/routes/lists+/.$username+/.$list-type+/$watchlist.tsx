import { invariantResponse } from '@epic-web/invariant'
import { json, type LoaderFunctionArgs } from '@remix-run/node'
import { useLoaderData } from '@remix-run/react'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { listNavButtons } from '#app/components/list-nav-buttons.jsx'
import { prisma } from '#app/utils/db.server.ts'
import { entryModelFromHeader } from '#app/utils/lists/authorization.server.ts'
import { watchlistGrid } from '#app/routes/lists+/.$username+/.$list-type+/grid/watchlist-grid.tsx'
import { useOptionalUser } from '#app/utils/user.ts'
import '#app/styles/watchlist.scss'

export async function loader(params: LoaderFunctionArgs) {
  const listOwner = await prisma.user.findUnique({
    where: {
      username: params['params']['username']!,
    },
  })

  invariantResponse(listOwner, 'User not found', { status: 404 })

  const listType = params['params']['list-type']
  const listTypes = await prisma.listType.findMany()
  const listTypeData = listTypes.find((type) => type.name === listType)
  // Guard before reading `.header`/`.id`: the original accessed these before its 404
  // check, so a missing list type would have thrown a 500 instead of the intended 404.
  invariantResponse(listTypeData, 'List type not found', { status: 404 })
  const typeFormatted = entryModelFromHeader(listTypeData.header)

  invariantResponse(typeFormatted, 'List type not found', { status: 404 })

  const watchLists = await prisma.watchlist.findMany({
    where: {
      ownerId: listOwner.id,
    },
  })

  let watchListData

  const watchListsSorted = watchLists.sort((a, b) => a.position - b.position)

  for (const watchList of watchLists) {
    if (watchList.typeId == listTypeData.id) {
      if (watchList.name == params['params']['watchlist']) {
        watchListData = watchList
        break
      }
    }
  }

  // Narrowing via the entity itself (equivalent to the old `listFound` flag) tells the
  // type-checker `watchListData` is defined below.
  invariantResponse(watchListData, 'Watchlist not found', { status: 404 })

  const typedWatchlists = watchLists.reduce<Record<string, typeof watchLists>>(
    (x, y) => {
      (x[y.typeId] = x[y.typeId] || []).push(y)
      return x
    },
    {},
  )

  // `typeFormatted` is allowlist-validated; the dynamic delegate access is intentional.
  const listEntries = await (prisma as any)[typeFormatted].findMany({
    where: {
      watchlistId: watchListData.id,
    },
  })

  const listEntriesSorted = listEntries.sort(
    (a: any, b: any) => a.position - b.position,
  )

  const favorites = await prisma.userFavorite.findMany({
    where: {
      ownerId: listOwner.id,
    },
  })

  const typedFavorites = favorites.reduce<Record<string, typeof favorites>>(
    (x, y) => {
      (x[y.typeId] = x[y.typeId] || []).push(y)
      return x
    },
    {},
  )

  return json({
    watchList: params['params']['watchlist'],
    username: params['params']['username'],
    listType: params['params']['list-type'],
    listTypes,
    listTypeData,
    listEntries: listEntriesSorted,
    watchLists,
    watchListsSorted,
    typedWatchlists,
    watchListData,
    watchlistId: watchListData.id,
    typedFavorites,
    listOwner,
  })
}

export function ErrorBoundary() {
  return (
    <GeneralErrorBoundary
      statusHandlers={{
        404: ({ params }) => (
          <p>No watchlist with the the name "{params.watchlist}" exists</p>
        ),
      }}
    />
  )
}

export default function WatchList() {
  const currentUser = useOptionalUser()
  const currentUserId = currentUser ? currentUser.id : null
  const loaderData = useLoaderData<typeof loader>()

  return (
    <main className="user-watchlist">
      {watchlistGrid(
        loaderData.listEntries,
        loaderData.watchListData,
        loaderData.listTypeData,
        loaderData.watchlistId,
        loaderData.typedWatchlists,
        loaderData.typedFavorites,
        loaderData.listOwner,
        currentUser,
        currentUserId,
        (loaderData as any).VEUD_API_KEY,
      )}
      {listNavButtons(
        loaderData.typedWatchlists,
        loaderData.username,
        loaderData.listTypes,
        loaderData.listTypeData,
        loaderData.watchListData,
      )}
    </main>
  )
}
