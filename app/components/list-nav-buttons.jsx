import { Link } from "@remix-run/react"

export function listNavButtons(params) {
  console.log(params)

  return (
    <div class="flex flex-row gap-4 justify-center bg-[#464646] border-t-8 border-t-[#54806C] pt-3 pb-1 shadow-[inset_0_-6px_8px_rgba(0,0,0,0.6)]" id="list-nav">
      {params.map( list =>
        <Link to={"../lists/" + list.name}
        class="bg-[#6F6F6F] hover:bg-[#8CA99D] text-[#FFEFCC] font-family: arial text-s font-bold py-5 px-16 border-b-4 border-[#A2FFD5] hover:border-[#80FFC6] rounded"> 
          {list.header}
        </Link>
      )}
    </div>
  )
}
