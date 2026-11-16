const api = process.env.PRECEDENT_API_URL || "http://127.0.0.1:8000";

const server = process.env.PRECEDENT_STATIC_DEMO !== "1";
const basePath = process.env.PRECEDENT_BASE_PATH || "";

export default {
  poweredByHeader: false,
  devIndicators: false,
  basePath,
  env: {
    NEXT_PUBLIC_PRECEDENT_BASE_PATH: basePath,
    NEXT_PUBLIC_PRECEDENT_STATIC_DEMO: server ? "0" : "1",
  },
  ...(server ? { async rewrites() { return [{ source: "/api/:path*", destination: api + "/api/:path*" }]; } } : { output: "export", trailingSlash: true }),
};
