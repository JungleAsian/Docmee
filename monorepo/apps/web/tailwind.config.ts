import type { Config } from "tailwindcss";
import preset from "@docmee/ui/preset";

const config: Config = {
  presets: [preset],
  content: [
    "./src/**/*.{ts,tsx}",
    // Pull design-system class names into the build so they are not purged.
    "../../packages/ui/src/**/*.{ts,tsx}",
  ],
};

export default config;
