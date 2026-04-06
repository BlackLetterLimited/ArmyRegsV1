import type { MetadataRoute } from "next";
import appIcon from "../appicon.jpg";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ArmyRegs.ai",
    short_name: "ArmyRegs.ai",
    description: "JagGPT chat powered by your backend.",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f1e8",
    theme_color: "#f5f1e8",
    icons: [
      {
        src: appIcon.src,
        sizes: "any",
        type: "image/jpeg",
      },
    ],
  };
}
