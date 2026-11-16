import "@fontsource-variable/bricolage-grotesque";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "./globals.css";
import { publicAsset } from "./public-asset";

export const metadata = {
  title: { default: "Precedent — Incident memory", template: "%s | Precedent" },
  description: "Find earlier incidents, follow their evidence paths, and record what worked.",
  icons: { icon: publicAsset("/mark.svg") },
};

export default function RootLayout({ children }) {
  return <html lang="en"><body>{children}</body></html>;
}
