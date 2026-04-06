import type { Metadata } from "next";
import { Source_Serif_4 } from "next/font/google";
import { FirebaseAuthProvider } from "../components/auth/auth-provider";
import appIcon from "../appicon.jpg";
import "./globals.css";

const sourceSerif4 = Source_Serif_4({
  subsets: ["latin"],
  variable: "--font-source-serif-4",
  weight: ["400", "600", "700"],
});

export const metadata: Metadata = {
  title: "ArmyRegs.ai",
  description: "JagGPT chat powered by your backend.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: appIcon.src, type: "image/jpeg" }],
    shortcut: [{ url: appIcon.src, type: "image/jpeg" }],
    apple: [{ url: appIcon.src, type: "image/jpeg" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={sourceSerif4.variable}>
        <FirebaseAuthProvider>{children}</FirebaseAuthProvider>
      </body>
    </html>
  );
}
