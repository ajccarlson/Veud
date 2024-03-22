import { WatchList } from "#app/routes/lists+/lists.$watchlist.jsx";
import "#app/styles/list-landing.css";
import { watchLists } from "#app/utils/lists/watchlists";

let listNavButtons = watchLists.map( list =>
  <button class="bg-[#6F6F6F] hover:bg-[#8CA99D] text-[#FFEFCC] font-family: arial text-s font-bold py-5 px-16 border-b-4 border-[#A2FFD5] hover:border-[#80FFC6] rounded"> 
    {list['name']}
  </button>
)

export default function Index() {
  return (
    <main style={{ width: '100%', height: '100%' }}>
      <WatchList/>
      <div class="flex flex-row gap-4 justify-center bg-[#464646]" id="list-nav">
        {listNavButtons}
      </div>
    </main>
  )
}