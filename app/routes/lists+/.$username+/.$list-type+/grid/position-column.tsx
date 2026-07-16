// The position column for the watchlist grid (Phase 3.2, increment 3) — the row-management
// cell: a move-row Form, and a dropdown with insert-above/below, delete, update-entry,
// update-all, and add/remove-favorite. By far the most involved single column. Returned as a
// one-element array (spread into columnDefs()) for uniformity with the other column groups.
import { Form } from '@remix-run/react'
import { Input } from '#app/components/ui/input.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
} from '#app/components/ui/dropdown-menu.tsx'
import { gridAPI, columnParams } from './grid-state.ts'
import { setterFunction, getAllRows, createNewRow, updatePositions, refreshGrid } from './grid-actions.ts'
import { getSiteIdSafe, getThumbnailInfo, updateRowInfo } from '#app/utils/lists/column-functions.tsx'

export function positionColumn() {
  return [
    {
      field: 'position',
      headerName: '#',
      valueSetter: (params: any) => {setterFunction(params)},
      editable: false,
      resizable: false,
      minWidth: 60,
      maxWidth: 60,
      filter: 'agNumberColumnFilter',
      rowDrag: columnParams.currentUserId == columnParams.listOwner.id,
      cellRenderer: (params: any) => {
        return (
          <div>
            {columnParams.currentUserId == columnParams.listOwner.id ?
              <div>
                <Form
                  method="GET"
                  onSubmit={async (event: any) => {
                    event.preventDefault();

                    let agRows = getAllRows()
                    const agRow = agRows[params.node.id]
                    const deleteResponse = gridAPI.applyTransaction({ remove: [agRow] })
                    
                    let addPosition = event.target.moveRowIndex.value
                    if (addPosition > agRows.length - 1) {
                      addPosition = (agRows.length - 1)
                    }
                    else if (addPosition < 1) {
                      addPosition = 1
                    }

                    let addRow = params.node.data
                    addRow.position = addPosition

                    const addResponse = gridAPI.applyTransaction({
                      add: [addRow],
                      addIndex: addPosition - 1,
                    })

                    const rowNode = gridAPI.getRowNode(addPosition - 1)
                    rowNode.setDataValue("position", Number(addPosition))
                  }}
                >
                  <Input
                    name="moveRowIndex"
                    className="ag-row-index ag-move-row-input"
                    id="moveRowIndex"
                    autoComplete='false'
                    placeholder={params.value}
                  />
                </Form>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <span className='ag-cell-insert'>
                      <Icon name="plus"></Icon>
                    </span>
                  </DropdownMenuTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuContent sideOffset={8} align="start">
                      <DropdownMenuItem onSelect={event => {
                        createNewRow("Above", params)
                      }}>
                        Insert 1 row above
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={event => {
                        createNewRow("Below", params)
                      }}>
                        Insert 1 row below
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={async event => {
                        const deleteResponse = await fetch('/lists/fetch/delete-row/' + encodeURIComponent(new URLSearchParams({
                          authorization: columnParams.VEUD_API_KEY,
                          listTypeData: JSON.stringify(columnParams.listTypeData),
                          id: params.data.id,
                        } as any).toString()), { method: 'POST' })

                        const updateResponse = await fetch('/lists/fetch/now-updated/' + encodeURIComponent(new URLSearchParams({
                          authorization: columnParams.VEUD_API_KEY,
                          watchlistId: params.data.watchlistId
                        } as any).toString()), { method: 'POST' })

                        const deleteTransaction = gridAPI.applyTransaction({ remove: [params.data] })

                        updatePositions()
                      }}>
                        Delete row
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={async event => {
                        updateRowInfo(params, columnParams, false)
                      }}>
                        Update entry info
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={async event => {
                        gridAPI.forEachNode(async (rowNode: any, index: number) => {
                          await updateRowInfo(rowNode, columnParams, true)
                        });
                      
                        refreshGrid(columnParams)
                      }}>
                        Update all watchlist entries
                      </DropdownMenuItem>
                      {columnParams.favoriteIds?.includes(getSiteIdSafe(getThumbnailInfo(params.data.thumbnail).url)?.id) ? 
                        <DropdownMenuItem onSelect={async event => {
                          const deleteRow = columnParams.typedFavorites[columnParams.listTypeData.id].filter((favorite: any) => {
                            return getSiteIdSafe(getThumbnailInfo(favorite.thumbnail).url)?.id === getSiteIdSafe(getThumbnailInfo(params.data.thumbnail).url)?.id
                          })

                          const deleteResponse = await fetch('/lists/fetch/remove-favorite/' + encodeURIComponent(new URLSearchParams({
                            authorization: columnParams.VEUD_API_KEY,
                            id: deleteRow[0].id,
                          } as any).toString()), { method: 'POST' })

                          columnParams.setFavoriteIds(columnParams.favoriteIds.filter((favoriteId: any) => favoriteId !== getSiteIdSafe(getThumbnailInfo(params.data.thumbnail).url)?.id))
                        }}>
                          Remove from favorites
                        </DropdownMenuItem>
                      :
                        <DropdownMenuItem onSelect={async event => {
                          const addPosition = Object.entries(columnParams.typedFavorites[columnParams.listTypeData.id]).length + 1
                          const typeColumns = JSON.parse(columnParams.listTypeData.columns) as any
                          const startTypes = ["airYear", "startYear", "startSeason"]
                          const startColumn = Object.keys(typeColumns).find((column) => startTypes.includes(column))

                          const addRow = {position: addPosition, thumbnail: params.data.thumbnail, title: params.data.title, typeId: columnParams.listTypeData.id, mediaType: params.data.type, startYear: params.data[startColumn as any], ownerId: columnParams.listOwner.id}

                          const addResponse = await fetch('/lists/fetch/add-favorite/' + encodeURIComponent(new URLSearchParams({
                            authorization: columnParams.VEUD_API_KEY,
                            favorite: JSON.stringify(addRow)
                          } as any).toString()), { method: 'POST' })

                          columnParams.setFavoriteIds([...columnParams.favoriteIds, getSiteIdSafe(getThumbnailInfo(params.data.thumbnail).url)?.id])
                        }}>
                          Add to favorites
                        </DropdownMenuItem>
                      }
                    </DropdownMenuContent>
                  </DropdownMenuPortal>
                </DropdownMenu>
              </div>
            :
              <div className="ag-row-index">
                {params.value}
              </div>
            } 
          </div>
        )
      },
      cellClass: "ag-position-cell",
      hide: !columnParams.displayedColumns['position'],
    },
  ]
}
