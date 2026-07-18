<<<<<<< HEAD
import { redirect } from "@remix-run/node"
=======
import { redirect } from 'react-router'
>>>>>>> develop

export async function loader() {
  return redirect("./acarlson9000", 303);
}
