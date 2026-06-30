import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { mountGoatGame, type GoatGameHandle, type GoatResult } from "chased-by-the-goat";
import { useMe } from "../lib/auth";
import { useGameLeaderboard, saveGameRun } from "../lib/game";

export function GoatGame() {
  const { data: me } = useMe();
  const { data: board } = useGameLeaderboard();
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
      player: { id: String(me.id), name: me.name || me.email, coins: board.me.coin_pool },
      leaderboard: board.distance.map((r) => ({ name: r.name, team: "", distance: r.distance ?? 0 })),
      coinLeaderboard: board.coins.map((r) => ({ name: r.name, team: "", coins: r.coins ?? 0 })),
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
          // Save failed (e.g. token race / rejected run) — leave boards as-is; the player can run again.
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
    handleRef.current.setLeaderboard(board.distance.map((r) => ({ name: r.name, team: "", distance: r.distance ?? 0 })));
    handleRef.current.setCoinLeaderboard(board.coins.map((r) => ({ name: r.name, team: "", coins: r.coins ?? 0 })));
    if (board.run_token && board.run_token !== tokenRef.current) {
      tokenRef.current = board.run_token;
      handleRef.current.setRunToken(board.run_token);
    }
  }, [board]);

  return <div className="goat-host" ref={hostRef} style={{ width: "100%" }} />;
}
