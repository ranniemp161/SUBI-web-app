import { redirect } from "next/navigation";
import { ROUGH_CUT_URL } from "@/lib/env";

export default function Home() {
  redirect(ROUGH_CUT_URL);
}
