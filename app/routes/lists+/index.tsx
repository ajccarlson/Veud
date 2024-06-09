import { redirect } from "@remix-run/node"

export async function loader() {
  return redirect("./acarlson9000", 303);
}
