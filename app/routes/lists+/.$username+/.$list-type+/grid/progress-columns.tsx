// Progress columns for the watchlist grid (length / chapters / volumes), extracted from
// $watchlist_grid.jsx's columnDefs() (Phase 3.2, increment 3). Returned in source order.
// NOTE: the commented-out dead block in the length renderer is preserved verbatim (behavior
// unchanged). The volumes editable check previously read `columnParams.listOwner.i` — a typo
// that made the volumes cell never editable for the list owner — now corrected to `.id`.
<<<<<<< HEAD
import { Form } from '@remix-run/react'
=======
import { Form } from 'react-router'
>>>>>>> develop
import { Input } from '#app/components/ui/input.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { columnParams } from './grid-state.ts'
import { setterFunction } from './grid-actions.ts'
import { mediaProgressParser } from '#app/utils/lists/column-functions.tsx'

export function progressColumns() {
  return [
    {
      field: 'length',
      headerName: 'Length',
      cellRenderer: (params: any) => {
        const totalLength = params.value

        let finishedValue: any
        try {
          finishedValue = (JSON.parse(params.data.history) as any).finished
        }
        catch(e) {}
        
        /*if (!params.value || params.value == "null" || params.value == "NULL" || params.value == 0) {
          return ""
        }
        else */if (finishedValue && finishedValue != "null" && finishedValue != "NULL" && finishedValue != 0) {
          return totalLength
        }
        else if (totalLength.includes("eps")) {
          const lengthData = mediaProgressParser(params, columnParams, params.value, undefined) as any

          return (
            <div className="ag-progress-cell">
              {columnParams.currentUserId == columnParams.listOwner.id ?
                <Form
                  method="GET"
                  onSubmit={async (event: any) => {
                    event.preventDefault();

                    const newParams = {...params, newValue : event.target.lengthInput.value, oldValue : params.value}

                    setterFunction(newParams)
                  }}
                  className="ag-progress-cell-text-container"
                >
                  <Input
                    name="lengthInput"
                    className="ag-progress-cell-input"
                    id={`${params.rowIndex}-length-input`}
                    autoComplete='false'
                    defaultValue={lengthData.progress  ?? ''}
                    placeholder={lengthData.progress}
                  />
                  <span className='ag-progress-increment-button' onClick={(event: any) => {
                    const newParams = {...params, newValue : lengthData.progress + 1, oldValue : params.value}
                    setterFunction(newParams)
                  }}>
                    <Icon name="plus"></Icon>
                  </span>
                  <span className="ag-progress-cell-span">{`/`}</span>
                  <span className="ag-progress-cell-span">{`${lengthData.total}`}</span>
                  <span className="ag-progress-cell-span">{`eps`}</span>
                </Form>
              :
                <div className="ag-progress-cell-text-container">
                  <span className="ag-progress-cell-span">{`${lengthData.progress}`}</span>
                  <span className="ag-progress-cell-span">{`/`}</span>
                  <span className="ag-progress-cell-span">{`${lengthData.total}`}</span>
                  <span className="ag-progress-cell-span">{`eps`}</span>
                </div>
              }
            </div>
          )
        }
        else {
          return totalLength
        }
      },
      minWidth: 180,
      maxWidth: 190,
      filter: "agTextColumnFilter",
      hide: !columnParams.displayedColumns['length'],
    },


    {
      field: 'chapters',
      headerName: 'Chapters',
      cellRenderer: (params: any) => {
        const chapterData = mediaProgressParser(params, columnParams, params.value, undefined) as any
        const emptyCell = !(params.data.title.replace(/\W/g, '') && params.data.type.replace(/\W/g, ''))
        
        return (
          <div className="ag-progress-cell">
            {emptyCell ?
              <div className="ag-progress-cell-text-container">
              </div>
            :columnParams.currentUserId == columnParams.listOwner.id && params.data.title.replace(/\W/g, '') && params.data.type.replace(/\W/g, '') ?
              <Form
                method="GET"
                onSubmit={async (event: any) => {
                  event.preventDefault();

                  const newParams = {...params, newValue : event.target.chapterInput.value, oldValue : params.value}

                  setterFunction(newParams)
                }}
                className="ag-progress-cell-text-container"
              >
                <Input
                  name="chapterInput"
                  className="ag-progress-cell-input"
                  id={`${params.rowIndex}-chapter-input`}
                  autoComplete='false'
                  defaultValue={chapterData.progress  ?? ''}
                  placeholder={chapterData.progress}
                />
                <span className='ag-progress-increment-button' onClick={(event: any) => {
                  const newParams = {...params, newValue : chapterData.progress + 1, oldValue : params.value}
                  setterFunction(newParams)
                }}>
                  <Icon name="plus"></Icon>
                </span>
                <span className="ag-progress-cell-span">{`/`}</span>
                <span className="ag-progress-cell-span">{`${chapterData.total}`}</span>
              </Form>
            :
              <div className="ag-progress-cell-text-container">
                <span className="ag-progress-cell-span">{`${chapterData.progress}`}</span>
                <span className="ag-progress-cell-span">{`/`}</span>
                <span className="ag-progress-cell-span">{`${chapterData.total}`}</span>
              </div>
            }
          </div>
        )
      },
      minWidth: 150,
      maxWidth: 160,
      filter: "agTextColumnFilter",
      hide: !columnParams.displayedColumns['chapters'],
    },


    {
      field: 'volumes',
      headerName: 'Volumes',
      cellRenderer: (params: any) => {
        const volumeData = mediaProgressParser(params, columnParams, params.value, undefined) as any
        const emptyCell = !(params.data.title.replace(/\W/g, '') && params.data.type.replace(/\W/g, ''))
        
        return (
          <div className="ag-progress-cell">
            {emptyCell ?
              <div className="ag-progress-cell-text-container">
              </div>
            :
            columnParams.currentUserId == columnParams.listOwner.id && !emptyCell ?
              <Form
                method="GET"
                onSubmit={async (event: any) => {
                  event.preventDefault();

                  const newParams = {...params, newValue : event.target.volumeInput.value, oldValue : params.value}

                  setterFunction(newParams)
                }}
                className="ag-progress-cell-text-container"
              >
                <Input
                  name="volumeInput"
                  className="ag-progress-cell-input"
                  id={`${params.rowIndex}-volume-input`}
                  autoComplete='false'
                  defaultValue={volumeData.progress  ?? ''}
                  placeholder={volumeData.progress}
                />
                <span className='ag-progress-increment-button' onClick={(event: any) => {
                  const newParams = {...params, newValue : volumeData.progress + 1, oldValue : params.value}
                  setterFunction(newParams)
                }}>
                  <Icon name="plus"></Icon>
                </span>
                <span className="ag-progress-cell-span">{`/`}</span>
                <span className="ag-progress-cell-span">{`${volumeData.total}`}</span>
              </Form>
            :
              <div className="ag-progress-cell-text-container">
                <span className="ag-progress-cell-span">{`${volumeData.progress}`}</span>
                <span className="ag-progress-cell-span">{`/`}</span>
                <span className="ag-progress-cell-span">{`${volumeData.total}`}</span>
              </div>
            }
          </div>
        )
      },
      minWidth: 140,
      maxWidth: 150,
      filter: "agTextColumnFilter",
      hide: !columnParams.displayedColumns['volumes'],
    },
  ]
}
