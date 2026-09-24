import { describe, expect, it } from 'vitest';
import { GazeState } from '../src/core';
import { gazeFromPitch, PaperEnterDeg, PaperExitDeg } from '../src/game/lookGaze';

const MID = (PaperEnterDeg + PaperExitDeg) / 2;

describe('2.1 gaze state is read from the look pitch, not from a key', () => {
  it('looking down enters the paper state', () => {
    expect(gazeFromPitch(GazeState.LookingAround, PaperEnterDeg)).toBe(GazeState.Paper);
    expect(gazeFromPitch(GazeState.LookingAround, 80)).toBe(GazeState.Paper);
  });

  it('looking up leaves the paper state', () => {
    expect(gazeFromPitch(GazeState.Paper, PaperExitDeg)).toBe(GazeState.LookingAround);
    expect(gazeFromPitch(GazeState.Paper, -40)).toBe(GazeState.LookingAround);
  });

  it('inside the hysteresis band the state does not flicker', () => {
    expect(gazeFromPitch(GazeState.Paper, MID)).toBe(GazeState.Paper);
    expect(gazeFromPitch(GazeState.LookingAround, MID)).toBe(GazeState.LookingAround);
  });

  it('the enter threshold sits above the exit threshold', () => {
    expect(PaperEnterDeg).toBeGreaterThan(PaperExitDeg);
  });

  it('a phone in hand ignores the pitch (space owns that state)', () => {
    expect(gazeFromPitch(GazeState.Phone, 80)).toBe(GazeState.Phone);
    expect(gazeFromPitch(GazeState.Phone, -60)).toBe(GazeState.Phone);
  });
});
