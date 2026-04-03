import Image from "next/image";
import Link from "next/link";
import logo from "../../logo.png";

export default function SiteHeaderLogo() {
  return (
    <Link href="/" className="site-header__logo-link" aria-label="ArmyRegs.ai — Home">
      <Image src={logo} alt="" width={1093} height={253} className="site-header__logo" priority />
    </Link>
  );
}
