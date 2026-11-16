export function publicAsset(path) {
  return (process.env.NEXT_PUBLIC_PRECEDENT_BASE_PATH || "") + path;
}
