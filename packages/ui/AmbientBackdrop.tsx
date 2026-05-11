"use client";

import type { CSSProperties } from "react";

interface AmbientBackdropProps {
  /** Path to the photo (e.g. "/photos/signin-01.jpg") */
  src: string;
  /** "hero" = lighter overlay for portal hero strips. "full" = heavier, for sign-in full-page. */
  variant?: "full" | "hero";
  /** Image objectPosition, e.g. "center 55%". Defaults to "center". */
  position?: string;
}

/**
 * Ambient photo backdrop — heavy darken + navy overlay so the photo reads
 * as texture, not content. Place as first child of a `position: relative`
 * container; siblings sit above it.
 */
export function AmbientBackdrop({
  src,
  variant = "full",
  position = "center",
}: AmbientBackdropProps) {
  const isHero = variant === "hero";
  const imgStyle: CSSProperties = {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "cover",
    objectPosition: position,
    filter: isHero
      ? "brightness(0.7) saturate(0.65)"
      : "brightness(0.65) saturate(0.7)",
  };
  const overlay: CSSProperties = {
    position: "absolute",
    inset: 0,
    background: isHero
      ? "linear-gradient(120deg, rgba(10,35,72,0.65) 0%, rgba(8,29,62,0.35) 55%, rgba(6,26,54,0.55) 100%)"
      : "linear-gradient(135deg, rgba(6,27,55,0.55) 0%, rgba(7,26,54,0.35) 50%, rgba(5,13,28,0.65) 100%)",
  };
  const vignette: CSSProperties = {
    position: "absolute",
    inset: 0,
    background:
      "radial-gradient(ellipse 70% 60% at 30% 50%, transparent 0%, rgba(5,13,28,0.35) 100%)",
  };

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" style={imgStyle} aria-hidden="true" />
      <div style={overlay} aria-hidden="true" />
      {!isHero && <div style={vignette} aria-hidden="true" />}
    </>
  );
}
