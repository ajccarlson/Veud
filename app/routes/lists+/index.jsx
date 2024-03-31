import { redirect } from "@remix-run/node";
import "#app/styles/list-landing.css";


export async function loader() {
  return redirect("./watching", 303);
}
