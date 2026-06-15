import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Slim, self-contained server output for container deploys.
  output: "standalone",
  // Workspace packages are shipped as TypeScript source — let Next transpile them.
  transpilePackages: ["@docmee/ui", "@docmee/contracts"],
  experimental: {
    typedRoutes: true,
  },
};

export default withNextIntl(nextConfig);
