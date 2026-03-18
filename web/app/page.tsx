"use client";

import Image from "next/image";
import ChatShell from "../components/chat/chat-shell";
import logo from "../logo.png";

function handleLogoClick() {
  window.dispatchEvent(new CustomEvent("jag:new-topic"));
}

export default function Home() {
  return (
    <div className="app-shell">
      <header className="site-header" aria-label="Application header">
        <div className="site-header__inner">
          <button
            type="button"
            className="site-header__logo-button"
            onClick={handleLogoClick}
            aria-label="Start a new topic"
          >
            <Image
              src={logo}
              alt="ArmyRegs.ai logo"
              width={150}
              height={150}
              className="site-header__logo"
              priority
            />
          </button>
        </div>
      </header>
      <ChatShell />
    </div>
  );
}
