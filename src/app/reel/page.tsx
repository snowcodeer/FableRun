import type { Metadata } from "next";

import ReelDemo from "@/components/reel-demo";

export const metadata: Metadata = {
  title: "Reel Mode — FableRun",
  description: "Turn a running clip into a 9:16 FableRun apocalypse demo.",
};

export default function ReelPage() {
  return <ReelDemo />;
}
