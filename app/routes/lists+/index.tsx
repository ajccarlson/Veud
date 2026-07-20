import { redirect } from 'react-router'

export async function loader() {
  return redirect("./acarlson9000", 303);
}
