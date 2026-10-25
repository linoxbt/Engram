import { ImageResponse } from "next/og";

export const alt = "Engram: memory you can prove";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** The social card: white with black type, like the site. */
export default function OpengraphImage() {
  const blocks = Array.from({ length: 14 }, (_, i) => i);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#ffffff", color: "#0a0a0a", padding: "72px 80px", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 30, letterSpacing: 6, textTransform: "uppercase" }}>
          <div style={{ width: 28, height: 28, border: "4px solid #0a0a0a", borderRadius: 4 }} />
          engram
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 104, fontWeight: 600, letterSpacing: -4, lineHeight: 1 }}>Memory you can prove.</div>
          <div style={{ marginTop: 28, fontSize: 34, color: "#686868" }}>Verifiable, time-travelling memory for AI agents on Appwrite VectorsDB.</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {blocks.map((i) => (
            <div key={i} style={{ display: "flex", width: 40, height: 40, borderRadius: 3, border: `3px solid ${i === 13 ? "#946d00" : "#0a0a0a"}`, background: i % 4 === 3 ? "rgba(10,10,10,0.08)" : "#ffffff" }} />
          ))}
          <div style={{ marginLeft: 18, fontSize: 26, color: "#946d00" }}>signed checkpoint</div>
        </div>
      </div>
    ),
    size,
  );
}
