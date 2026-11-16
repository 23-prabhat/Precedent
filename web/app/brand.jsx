import Link from "next/link";
import { publicAsset } from "./public-asset";

export default function Brand() {
  return <Link href="/" className="brand" aria-label="Precedent home">
    <img src={publicAsset("/mark.svg")} alt="" width="35" height="35" />
    <span>Precedent</span>
  </Link>;
}
