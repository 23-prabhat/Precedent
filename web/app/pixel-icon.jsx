import { publicAsset } from "./public-asset";

export default function PixelIcon({ name, size = 16 }) {
  return <span className="pixel-icon" aria-hidden="true" style={{ width: size, height: size, maskImage: `url(${publicAsset(`/icons/${name}.svg`)})` }} />;
}
