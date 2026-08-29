import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://fablerun.vercel.app"),
  title: "FableRun — Run the story",
  description:
    "An adaptive audio adventure where the plot creates your workout and your run changes the ending.",
  openGraph: {
    title: "FableRun — Run the story",
    description:
      "An adaptive audio adventure where the plot creates your workout and your run changes the ending.",
    images: [{ url: "/og.png", width: 1536, height: 1024, alt: "FableRun runner at night" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "FableRun — Run the story",
    description:
      "An adaptive audio adventure where the plot creates your workout and your run changes the ending.",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}
