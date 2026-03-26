import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Sidebar from "@/components/Sidebar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "My Stock Scheduler",
  description: "Stock research and scheduler workspace",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} app-shell antialiased flex h-screen flex-col overflow-hidden bg-[var(--background)] text-[var(--foreground)]`}
      >
        <Sidebar />
        <div className="relative flex flex-1 flex-col overflow-hidden">
          {children}
        </div>
      </body>
    </html>
  );
}
