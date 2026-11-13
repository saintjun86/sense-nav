import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "SENSE NAV — 차량 센서 기반 GPS 비의존 내비게이션",
  description: "GPS가 끊겨도, 차량 센서로 길을 잇습니다. 차량 센서 기반 경로·경사·고도 추정을 보여주는 지하주행 시뮬레이터.",
  icons: { icon: "/favicon.svg" },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}
