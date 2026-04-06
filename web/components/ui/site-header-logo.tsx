import Image from "next/image";
import Link from "next/link";
import logo from "../../logo.png";

type SiteHeaderLogoProps = {
  href?: string;
  ariaLabel?: string;
};

export default function SiteHeaderLogo({
  href = "/",
  ariaLabel = "ArmyRegs.ai — Home"
}: SiteHeaderLogoProps) {
  return (
    <Link href={href} className="site-header__logo-link" aria-label={ariaLabel}>
      <Image src={logo} alt="" width={1093} height={253} className="site-header__logo" priority />
    </Link>
  );
}
