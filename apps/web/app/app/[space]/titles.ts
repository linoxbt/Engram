import type { Metadata } from "next";

/** Per-route titles for a space's pages, like "Memories · k7m2q9xa · Engram". */
export const spaceTitle = (title: string) =>
  async ({ params }: { params: Promise<{ space: string }> }): Promise<Metadata> => {
    const { space } = await params;
    return { title: `${title} · ${space}`, robots: { index: false } };
  };
