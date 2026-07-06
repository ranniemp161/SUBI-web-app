import { redirect } from "next/navigation";

export default function Home() {
  redirect(process.env.NEXT_PUBLIC_ROUGH_CUT_URL || "http://localhost:3001");
}
