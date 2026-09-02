import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "도심 재난 알림",
  description: "재난문자·실종 정보를 지도에서 확인하고 LLM으로 분석합니다.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
