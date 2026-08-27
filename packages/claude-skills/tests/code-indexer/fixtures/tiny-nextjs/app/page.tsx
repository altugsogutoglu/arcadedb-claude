import { Button } from "../components/Button";
import { getUsers } from "../lib/db";

export default async function Page() {
  const users = await getUsers();
  return <div><Button>Click</Button>{users.length}</div>;
}
