import "./globals.css";
import { Manrope } from "next/font/google";
import { LanguageProvider } from "@/components/language-provider";

const manrope = Manrope({ subsets: ["latin"] });

export const metadata = {
  title: "AEO/GEO Tracking",
  description: "Lifewood AEO/GEO tracking, AI search visibility, and brand performance analytics.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={manrope.className}><LanguageProvider>{children}</LanguageProvider></body>
    </html>
  );
}
