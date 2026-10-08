import "./globals.css";

export const metadata = {
  title: "Lifewood AI Visibility",
  description: "AI visibility monitoring and analytics platform",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}