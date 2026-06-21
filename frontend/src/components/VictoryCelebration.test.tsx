import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { VictoryCelebration } from "./VictoryCelebration";
import type { Celebration } from "../lib/celebrations";

// jsdom has no canvas/AudioContext — stub enough that the effect doesn't throw.
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    setTransform: () => {}, clearRect: () => {}, save: () => {}, restore: () => {},
    translate: () => {}, rotate: () => {}, fillRect: () => {}, beginPath: () => {},
    arc: () => {}, ellipse: () => {}, moveTo: () => {}, lineTo: () => {},
    quadraticCurveTo: () => {}, closePath: () => {}, fill: () => {}, stroke: () => {},
    fillStyle: "", strokeStyle: "", globalAlpha: 1, lineWidth: 1, lineCap: "",
    shadowColor: "", shadowBlur: 0,
  } as unknown as CanvasRenderingContext2D);
  // @ts-expect-error — jsdom has no AudioContext; createVictoryAudio catches and no-ops.
  window.AudioContext = undefined;
});

const sample: Celebration = {
  match_id: 12, team_code: "BRA", team_score: 3,
  opponent_code: "JOR", opponent_score: 1, kickoff_utc: "2026-06-19T18:00:00Z",
};

describe("VictoryCelebration", () => {
  it("renders the scorecard from the celebration prop", () => {
    render(<VictoryCelebration celebration={sample} onDone={() => {}} />);
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByLabelText("BRA 3, JOR 1")).toBeInTheDocument();
  });

  it("calls onDone when Skip is clicked", () => {
    const onDone = vi.fn();
    render(<VictoryCelebration celebration={sample} onDone={onDone} />);
    fireEvent.click(screen.getByText(/Skip to results/i));
    // finishNow defers onDone by ~420ms; flush timers.
    return new Promise<void>((resolve) => setTimeout(() => { expect(onDone).toHaveBeenCalled(); resolve(); }, 500));
  });
});
