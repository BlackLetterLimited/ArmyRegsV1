"use client";

import Image from "next/image";
import ChatShell from "../components/chat/chat-shell";
import logo from "../logo.png";

export default function Home() {
  return (
    <div className="app-shell">
      <header className="site-header" aria-label="Application header">
        <div className="site-header__inner">
          <Image
            src={logo}
            alt="ArmyRegs.ai logo"
            width={150}
            height={150}
            className="site-header__logo"
            priority
          />
        </div>
      </header>
      <ChatShell />
    </div>
  );
}
