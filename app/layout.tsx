import type { Metadata, Viewport } from "next";
import "./globals.css";
import PwaRegister from "../components/PwaRegister";

export const metadata: Metadata = {
  title: "Purchasing Supplier Evaluation System",
  description: "Purchasing Supplier Evaluation System for supplier evaluations, PO documents, reports, and cloud records.",
  applicationName: "Purchasing Supplier Evaluation System",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/sisc-logo.png",
    shortcut: "/sisc-logo.png",
    apple: "/sisc-logo.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#4f247c",
  colorScheme: "light dark",
};

export default function RootLayout({children}:{children:React.ReactNode}) {
  return <html lang="en"><body><PwaRegister />{children}</body></html>;
}
