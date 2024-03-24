import { Link } from "@remix-run/react"
import { watchLists } from "#app/utils/lists/watchlists"

export const listNavButtons = 
<div class="flex flex-row gap-4 justify-center bg-[#464646]" id="list-nav">
  {watchLists.map( list =>
    <Link to={"../lists/" + list['name'].replace(/[^a-z0-9_]+/gi, '').toLowerCase()}
    class="bg-[#6F6F6F] hover:bg-[#8CA99D] text-[#FFEFCC] font-family: arial text-s font-bold py-5 px-16 border-b-4 border-[#A2FFD5] hover:border-[#80FFC6] rounded"> 
      {list['name']}
    </Link>
  )}
</div>