import { Game } from "@/components/game/Game";
import { DemoBanner } from "@/components/kit/DemoBanner";
import generateFixtures from "@/fixtures/generate.json";
import interrogateFixtures from "@/fixtures/interrogate.json";
import { THE_FOURTH_COURSE } from "@/lib/case/handcrafted";
import { toPublicCase } from "@/lib/case/public";

/**
 * A server component on purpose: the case file (solution included) is read
 * here, and only its public projection crosses into the client bundle.
 */
export default function Home() {
  const publicCase = toPublicCase(THE_FOURTH_COURSE);
  // The page says "sample", not "recorded", for as long as any fixture is hand-written.
  const samples = {
    answers: Object.values(interrogateFixtures).some((f) => f.placeholder),
    generation: Object.values(generateFixtures).some((f) => f.placeholder),
  };

  return (
    <>
      <DemoBanner placeholder={samples.answers || samples.generation} />
      <Game initialCase={publicCase} samples={samples} />
      <footer className="border-t border-border px-4 py-4 text-center text-xs text-muted">
        A work of fiction, rated PG-13. Built with Claude Code and Claude Opus 5.5.
      </footer>
    </>
  );
}
