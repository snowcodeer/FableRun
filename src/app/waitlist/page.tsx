import type { Metadata } from "next";
import Link from "next/link";

import { WaitlistForm } from "@/components/waitlist-form";

export const metadata: Metadata = {
  title: "Join the waitlist · FableRun",
  description: "Get early access to FableRun—the running app where your pace controls the story.",
};

export default function WaitlistPage() {
  return (
    <main className="waitlist-page">
      <div className="waitlist-page__scene" aria-hidden="true" />
      <header>
        <Link href="/" className="reel-wordmark">FABLE<span>RUN</span></Link>
        <Link href="/reel">Watch the demo</Link>
      </header>
      <section>
        <p>EARLY ACCESS · LONDON</p>
        <h1>DON’T WATCH<br />THE STORY.<br /><span>RUN IT.</span></h1>
        <div className="waitlist-page__copy">
          <p>Your pace controls the danger. Your voice changes the plot. Your run decides who makes it home.</p>
          <WaitlistForm source="waitlist" />
          <small>By joining, you agree to receive FableRun launch updates. Unsubscribe any time.</small>
        </div>
      </section>
    </main>
  );
}
