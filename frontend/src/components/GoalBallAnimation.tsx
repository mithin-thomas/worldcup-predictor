import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { RefObject } from "react";
import footballImage from "../assets/football.png";

export type GoalSide = "left" | "right";

export interface GoalBallAnimationHandle {
  play: (side: GoalSide) => void;
}

interface GoalBallAnimationProps {
  containerRef: RefObject<HTMLElement | null>;
  leftSourceRef: RefObject<HTMLElement | null>;
  rightSourceRef: RefObject<HTMLElement | null>;
  leftTargetRef: RefObject<HTMLElement | null>;
  rightTargetRef: RefObject<HTMLElement | null>;
}

interface Shot {
  id: number;
  direction: "left-to-right" | "right-to-left";
  startSide: GoalSide;
  targetSide: GoalSide;
  startX: number;
  startY: number;
  controlX: number;
  controlY: number;
  endX: number;
  endY: number;
  trailLength: number;
  spinDirection: 1 | -1;
}

const DURATION_MS = 720;
const CURVE_SAMPLES = 140;
const BUTTON_GLOW_MS = 420;

function getCenter(el: HTMLElement, container: HTMLElement) {
  const rect = el.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2 - containerRect.left,
    y: rect.top + rect.height / 2 - containerRect.top,
  };
}

function curvePoint(shot: Shot, t: number) {
  const inverse = 1 - t;
  return {
    x: inverse * inverse * shot.startX
      + 2 * inverse * t * shot.controlX
      + t * t * shot.endX,
    y: inverse * inverse * shot.startY
      + 2 * inverse * t * shot.controlY
      + t * t * shot.endY,
  };
}

function buildArcLengthTable(shot: Shot) {
  const table = [{ t: 0, length: 0 }];
  let previous = curvePoint(shot, 0);
  let totalLength = 0;

  for (let index = 1; index <= CURVE_SAMPLES; index += 1) {
    const t = index / CURVE_SAMPLES;
    const point = curvePoint(shot, t);
    totalLength += Math.hypot(point.x - previous.x, point.y - previous.y);
    table.push({ t, length: totalLength });
    previous = point;
  }

  return { table, totalLength };
}

function distanceProgressToCurveT(
  progress: number,
  table: ReturnType<typeof buildArcLengthTable>["table"],
  totalLength: number,
) {
  const targetLength = progress * totalLength;
  let low = 1;
  let high = table.length - 1;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (table[middle].length < targetLength) low = middle + 1;
    else high = middle;
  }

  const current = table[low];
  const previous = table[Math.max(0, low - 1)];
  const segmentLength = current.length - previous.length;
  const segmentProgress = segmentLength === 0
    ? 0
    : (targetLength - previous.length) / segmentLength;
  return previous.t + (current.t - previous.t) * segmentProgress;
}

function AnimatedShot({ shot, onComplete }: { shot: Shot; onComplete: (id: number) => void }) {
  const shotRef = useRef<HTMLSpanElement>(null);
  const ballRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const element = shotRef.current;
    const ball = ballRef.current;
    if (!element || !ball) return;

    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      onComplete(shot.id);
      return;
    }

    const { table, totalLength } = buildArcLengthTable(shot);
    let frameId = 0;
    let startTime: number | null = null;
    element.style.setProperty("--goal-trail-length", `${shot.trailLength}px`);

    const drawFrame = (timestamp: number) => {
      if (startTime === null) startTime = timestamp;

      const progress = Math.min((timestamp - startTime) / DURATION_MS, 1);
      const t = distanceProgressToCurveT(progress, table, totalLength);
      const point = curvePoint(shot, t);
      const tangentX = 2 * (1 - t) * (shot.controlX - shot.startX)
        + 2 * t * (shot.endX - shot.controlX);
      const tangentY = 2 * (1 - t) * (shot.controlY - shot.startY)
        + 2 * t * (shot.endY - shot.controlY);
      const angle = Math.atan2(tangentY, tangentX) * (180 / Math.PI);
      const fadeProgress = Math.max(0, (progress - 0.92) / 0.08);
      const opacity = 1 - fadeProgress * fadeProgress;
      const trailRamp = Math.min(progress / 0.12, 1);
      const trailFade = progress < 0.9 ? 1 : Math.max(0, (1 - progress) / 0.1);

      element.style.transform = `translate3d(${point.x}px, ${point.y}px, 0) rotate(${angle}deg)`;
      element.style.opacity = String(Math.max(0, opacity));
      element.style.setProperty("--goal-trail-scale", String(trailRamp));
      element.style.setProperty("--goal-trail-opacity", String(trailFade));
      ball.style.transform = `rotate(${shot.spinDirection * progress * 720}deg)`;

      if (progress < 1) frameId = window.requestAnimationFrame(drawFrame);
      else onComplete(shot.id);
    };

    frameId = window.requestAnimationFrame(drawFrame);
    return () => window.cancelAnimationFrame(frameId);
  }, [onComplete, shot]);

  return (
    <span
      ref={shotRef}
      className={`goal-animation ${shot.direction}`}
      data-direction={shot.direction}
      data-start-side={shot.startSide}
      data-target-side={shot.targetSide}
    >
      <span className="goal-trail goal-trail--haze" />
      <span className="goal-trail goal-trail--core" />
      <span className="goal-ball-glow" />
      <img ref={ballRef} className="goal-ball" src={footballImage} alt="" />
    </span>
  );
}

export const GoalBallAnimation = forwardRef<GoalBallAnimationHandle, GoalBallAnimationProps>(
  function GoalBallAnimation(
    {
      containerRef,
      leftSourceRef,
      rightSourceRef,
      leftTargetRef,
      rightTargetRef,
    },
    ref,
  ) {
    const [shots, setShots] = useState<Shot[]>([]);
    const nextIdRef = useRef(0);
    const glowTimersRef = useRef<Set<number>>(new Set());

    const removeShot = useCallback((id: number) => {
      setShots((current) => current.filter((shot) => shot.id !== id));
    }, []);

    useEffect(() => () => {
      glowTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    }, []);

    useImperativeHandle(ref, () => ({
      play(side) {
        const container = containerRef.current;
        const source = side === "left" ? leftSourceRef.current : rightSourceRef.current;
        const target = side === "left" ? rightTargetRef.current : leftTargetRef.current;
        if (!container || !source || !target) return;

        source.classList.remove("goal-glow");
        void source.offsetWidth;
        source.classList.add("goal-glow");
        const glowTimer = window.setTimeout(() => {
          source.classList.remove("goal-glow");
          glowTimersRef.current.delete(glowTimer);
        }, BUTTON_GLOW_MS);
        glowTimersRef.current.add(glowTimer);

        if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

        const start = getCenter(source, container);
        const end = getCenter(target, container);
        const horizontalDistance = Math.abs(end.x - start.x);
        const directDistance = Math.hypot(end.x - start.x, end.y - start.y);
        const desiredLift = Math.min(118, Math.max(54, horizontalDistance * 0.24));

        setShots((current) => [...current, {
          id: ++nextIdRef.current,
          direction: side === "left" ? "left-to-right" : "right-to-left",
          startSide: side,
          targetSide: side === "left" ? "right" : "left",
          startX: start.x,
          startY: start.y,
          controlX: start.x + (end.x - start.x) * 0.44,
          controlY: Math.max(16, Math.min(start.y, end.y) - desiredLift),
          endX: end.x,
          endY: end.y,
          trailLength: Math.min(58, Math.max(38, directDistance * 0.13)),
          spinDirection: side === "left" ? 1 : -1,
        }]);
      },
    }), [containerRef, leftSourceRef, leftTargetRef, rightSourceRef, rightTargetRef]);

    return (
      <div className="goal-animation-layer" aria-hidden="true">
        {shots.map((shot) => (
          <AnimatedShot key={shot.id} shot={shot} onComplete={removeShot} />
        ))}
      </div>
    );
  },
);
