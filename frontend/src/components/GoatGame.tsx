import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { mountGoatGame, type GoatGameHandle, type GoatResult } from "chased-by-the-goat";
import { useMe } from "../lib/auth";
import { useGameLeaderboard, saveGameRun } from "../lib/game";

// The bundle shows player.name in-game and on the leaderboard. Prefer the
// stored display name; if it's blank, derive a name from the email's local
// part (e.g. "mithin@sayonetech.com" -> "Mithin") rather than showing the
// raw email address.
function playerName(me: { name: string; email: string }): string {
  const name = me.name?.trim();
  if (name) return name;
  const local = me.email.split("@")[0] ?? "";
  const pretty = local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  return pretty || "Player";
}

export function GoatGame() {
  const { data: me, isPending: mePending } = useMe();
  const { data: board, isPending: boardPending } = useGameLeaderboard();
  const qc = useQueryClient();
  const hostRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<GoatGameHandle | null>(null);
  // Keep the freshest token/board in refs so onGameEnd (captured once at mount) reads current values.
  const tokenRef = useRef<string | undefined>(board?.run_token);

  // Mount once, after we have both the player and the first board+token.
  useEffect(() => {
    if (!hostRef.current || !me || !board || handleRef.current) return;
    tokenRef.current = board.run_token;
    handleRef.current = mountGoatGame(hostRef.current, {
      player: { id: String(me.id), name: playerName(me), coins: board.me.coin_pool },
      leaderboard: (board.distance ?? []).map((r) => ({ name: r.name, team: "", distance: r.distance ?? 0 })),
      coinLeaderboard: (board.coins ?? []).map((r) => ({ name: r.name, team: "", coins: r.coins ?? 0 })),
      runToken: board.run_token,
      async onGameEnd(result: GoatResult) {
        try {
          const res = await saveGameRun({
            run_token: result.runToken ?? tokenRef.current ?? "",
            distance: result.distance,
            coins: result.coins,
            duration_ms: result.durationMs,
          });
          tokenRef.current = res.run_token;
          handleRef.current?.setRunToken(res.run_token); // arm next run
          await qc.invalidateQueries({ queryKey: ["game-leaderboard"] }); // refetch → effect below pushes boards
        } catch {
          // Save failed (rejected run / network) — refetch so a fresh run_token is armed for the next run.
          void qc.invalidateQueries({ queryKey: ["game-leaderboard"] });
        }
      },
    });
    return () => {
      handleRef.current?.destroy();
      handleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, board]);

  // Push refreshed boards + token in place whenever the query data changes (no remount).
  useEffect(() => {
    if (!handleRef.current || !board) return;
    handleRef.current.setLeaderboard((board.distance ?? []).map((r) => ({ name: r.name, team: "", distance: r.distance ?? 0 })));
    handleRef.current.setCoinLeaderboard((board.coins ?? []).map((r) => ({ name: r.name, team: "", coins: r.coins ?? 0 })));
    if (board.run_token && board.run_token !== tokenRef.current) {
      tokenRef.current = board.run_token;
      handleRef.current.setRunToken(board.run_token);
    }
  }, [board]);

  if (mePending || boardPending) {
    return (
      <div className="goat-host" style={{ width: "100%", padding: "24px 16px" }}>
        <div className="skeleton skeleton--long" style={{ height: "180px", width: "100%", borderRadius: "var(--r-md)" }} />
      </div>
    );
  }

  return <div className="goat-host" ref={hostRef} style={{ width: "100%" }} />;
}
