import { describe, expect, it } from 'vitest';
import {
  ExamSession, FlipPhone, InvigilatorProfile, PhoneEventKind, PhoneKey, PhoneNotice, PhoneScreen, RunState,
  evaluateCalc, type PhoneEvent,
} from '../src/core';
import { testData, testTable } from './support';

function session(seed = 5): ExamSession {
  const s = new ExamSession(testData(), testTable(), new RunState(seed), InvigilatorProfile.patrol());
  s.begin();
  return s;
}

function phoneFor(seed = 5): FlipPhone {
  return session(seed).phone;
}

function type(phone: FlipPhone, keys: string, events: PhoneEvent[] = []): PhoneEvent[] {
  for (const k of keys) phone.press(k as PhoneKey, events);
  return events;
}

function run(phone: FlipPhone, seconds: number, screenOn: boolean, events: PhoneEvent[] = []): PhoneEvent[] {
  for (let t = 0; t < seconds; t += 0.05) phone.tick(0.05, screenOn, events);
  return events;
}

describe('decision #42: the phone is the answer engine', () => {
  it('every question gets a unique 4-digit code, deterministic per seed', () => {
    const a = phoneFor(5);
    const b = phoneFor(5);
    const codes = a.tasks.map((t) => t.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of codes) expect(c).toMatch(/^[1-9]\d{3}$/);
    expect(b.tasks.map((t) => t.code)).toEqual(codes);
  });

  it('searching a code returns the correct choice, costs 0.50 once connected and needs the phone held out', () => {
    const s = session();
    const phone = s.phone;
    const q = s.questions[2];
    phone.press(PhoneKey.D1, []);
    expect(phone.screen).toBe(PhoneScreen.Search);
    type(phone, phone.codeFor(2));
    phone.press(PhoneKey.Ok, []);
    expect(phone.screen).toBe(PhoneScreen.Searching);
    expect(phone.balanceCents).toBe(320);

    run(phone, 1.0, false);
    expect(phone.screen).toBe(PhoneScreen.Searching);
    const ev = run(phone, phone.searchSeconds + 0.1, true);
    expect(phone.screen).toBe(PhoneScreen.SearchResult);
    expect(phone.result).toEqual({ number: 3, answer: q.choices[q.correctIndex] });
    expect(phone.balanceCents).toBe(270);
    expect(ev.some((e) => e.kind === PhoneEventKind.SearchDone)).toBe(true);
  });

  it('closing the phone mid-search drops the connection: nothing charged, the wait is wasted', () => {
    const phone = phoneFor();
    type(phone, '1' + phone.codeFor(0));
    phone.press(PhoneKey.Ok, []);
    run(phone, 1.0, true);
    phone.putAway();
    expect(phone.screen).toBe(PhoneScreen.Home);
    expect(phone.result).toBeNull();
    expect(phone.balanceCents).toBe(320);
  });

  it('a wrong code finds nothing; an empty wallet is refused', () => {
    const phone = phoneFor();
    const unused = ['1111', '2222', '3333', '4444'].find((c) => !phone.tasks.some((t) => t.code === c))!;
    type(phone, '1' + unused);
    phone.press(PhoneKey.Ok, []);
    run(phone, phone.searchSeconds + 0.1, true);
    expect(phone.result).toEqual({ number: 0, answer: '' });

    phone.balanceCents = 40;
    phone.press(PhoneKey.Ok, []);
    type(phone, phone.codeFor(0));
    const ev: PhoneEvent[] = [];
    phone.press(PhoneKey.Ok, ev);
    expect(phone.screen).toBe(PhoneScreen.Search);
    expect(phone.notice).toBe(PhoneNotice.Balance);
    expect(ev.some((e) => e.kind === PhoneEventKind.Denied)).toBe(true);
  });

  it('asking the ace: a reply arrives 5-12 s later and rings unless silent', () => {
    const s = session();
    const phone = s.phone;
    const task = phone.tasks[3];
    const sent = type(phone, '24');
    phone.press(PhoneKey.Ok, sent);
    expect(sent.some((e) => e.kind === PhoneEventKind.Sent)).toBe(true);
    expect(phone.balanceCents).toBe(310);
    expect(phone.pendingReplies).toBe(1);

    phone.time = 100;
    const before = phone.inbox.length;
    const ev = run(phone, 12.1, false);
    const reply = phone.inbox.find((m) => m.question === 4);
    expect(reply).toBeDefined();
    expect(reply!.senderKey).toBe('sms.sender.ace');
    expect(reply!.text).toContain(task.askAnswer);
    expect(phone.inbox.length).toBeGreaterThan(before);
    expect(ev.some((e) => e.kind === PhoneEventKind.Ring)).toBe(true);
    expect(task.askDelay).toBeGreaterThanOrEqual(5);
    expect(task.askDelay).toBeLessThan(12);
  });

  it('silent mode: no key tones, no ringing', () => {
    const phone = phoneFor();
    type(phone, '5');
    phone.press(PhoneKey.Ok, []);
    expect(phone.silent).toBe(true);
    phone.press(PhoneKey.Back, []);
    const keys = type(phone, '24');
    expect(keys.every((e) => !e.audible)).toBe(true);
    phone.press(PhoneKey.Ok, []);
    phone.time = 200;
    const ev = run(phone, 12.1, false);
    expect(ev.some((e) => e.kind === PhoneEventKind.Ring)).toBe(false);
    expect(ev.some((e) => e.kind === PhoneEventKind.SilentArrival)).toBe(true);
  });

  it('the ace is mostly right, and only ever answers with one of the four choices', () => {
    let right = 0;
    let total = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const s = session(seed);
      s.phone.tasks.forEach((t, i) => {
        const q = s.questions[i];
        expect(q.choices).toContain(t.askAnswer);
        expect(t.askReliable).toBe(t.askAnswer === q.choices[q.correctIndex]);
        total++;
        if (t.askReliable) right++;
      });
    }
    expect(right / total).toBeGreaterThan(0.7);
    expect(right / total).toBeLessThan(0.95);
  });

  it('the first ambient message is 10086, about half a minute in', () => {
    const phone = phoneFor();
    const ev = run(phone, 40, false);
    expect(phone.inbox[phone.inbox.length - 1].senderKey).toBe('sms.sender.operator');
    expect(phone.inbox[phone.inbox.length - 1].at).toBeGreaterThanOrEqual(24);
    expect(ev.filter((e) => e.kind === PhoneEventKind.Ring).length).toBeGreaterThanOrEqual(1);
  });

  it('the calculator really computes (left to right, like a real one)', () => {
    expect(evaluateCalc('120*0.8')).toBe('96');
    expect(evaluateCalc('2018+5')).toBe('2023');
    expect(evaluateCalc('108/9')).toBe('12');
    expect(evaluateCalc('60-58')).toBe('2');
    expect(evaluateCalc('2+3*4')).toBe('20');
    expect(evaluateCalc('5/0')).toBe('E');

    const phone = phoneFor();
    type(phone, '4120***0#8');
    expect(phone.calcExpr).toBe('120*0.8');
    phone.press(PhoneKey.Ok, []);
    expect(phone.calcResult).toBe('96');
  });

  it('battery drains only with the screen on; a dead phone ignores keys', () => {
    const phone = phoneFor();
    run(phone, 30, false);
    expect(phone.battery).toBe(phone.batteryMax);
    run(phone, 30, true);
    expect(phone.battery).toBeLessThan(phone.batteryMax);
    const ev = run(phone, 400, true);
    expect(phone.dead).toBe(true);
    expect(phone.screen).toBe(PhoneScreen.Dead);
    expect(ev.some((e) => e.kind === PhoneEventKind.BatteryDead)).toBe(true);
    const after: PhoneEvent[] = [];
    phone.press(PhoneKey.D1, after);
    expect(after.length).toBe(0);
  });
});
