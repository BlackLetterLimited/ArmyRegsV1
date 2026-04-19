import Image from "next/image";
import Link from "next/link";
import type { MouseEventHandler } from "react";
import logo from "../../logo.png";

type SiteHeaderLogoProps = {
  href?: string;
  ariaLabel?: string;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
};

export default function SiteHeaderLogo({
  href = "/",
  ariaLabel = "ArmyRegs.ai — Home",
  onClick
}: SiteHeaderLogoProps) {
  return (
    <Link href={href} className="site-header__logo-link" aria-label={ariaLabel} onClick={onClick}>
      <Image src={logo} alt="" width={1093} height={253} className="site-header__logo" priority />
    </Link>
  );
}
