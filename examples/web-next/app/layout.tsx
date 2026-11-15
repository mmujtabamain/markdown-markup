import type { ReactNode } from "react";
import "./app.css";

export const metadata = { title: "Shop: Next.js" };

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
