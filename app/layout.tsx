import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Supplier Evaluation Pro",
  description: "OCR-powered supplier evaluation management",
};
export default function RootLayout({children}:{children:React.ReactNode}) {
  return <html lang="en"><body>{children}</body></html>;
}