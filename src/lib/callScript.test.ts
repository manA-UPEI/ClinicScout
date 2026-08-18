import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildScript,
  DISCLOSURE,
  isIvr,
  isRefusal,
  isVoicemail,
} from "./call/script.ts";

test("the disclosure is always the first thing said", () => {
  const script = buildScript("Riverside Walk-In Clinic");
  assert.equal(script[0].id, "disclosure");
  assert.equal(script[0].text, DISCLOSURE);
});

test("the disclosure states plainly that the caller is not a person", () => {
  // Phrasing may be reworded, but a call that does not say this should never
  // ship — an undisclosed synthetic voice is the thing regulators prohibit.
  assert.match(DISCLOSURE, /\bA\.?I\.?\b/i);
  assert.match(DISCLOSURE, /not a person/i);
});

test("the script takes the clinic name and nothing else", () => {
  // Structural guard against a later change threading patient detail into the
  // call. If someone adds a second parameter, this fails before it ships.
  assert.equal(buildScript.length, 1);
});

test("no line can carry patient detail", () => {
  const script = buildScript("Riverside Walk-In Clinic");
  const spoken = script.map((l) => l.text).join(" ").toLowerCase();

  for (const leak of [
    "symptom",
    "pain",
    "fever",
    "urgent",
    "emergency",
    "patient's name",
    "callback",
    "date of birth",
  ]) {
    assert.ok(!spoken.includes(leak), `script must not mention "${leak}"`);
  }
});

test("only the clinic name is interpolated", () => {
  const a = buildScript("Alpha Clinic");
  const b = buildScript("Beta Health Centre");
  const differing = a.filter((line, i) => line.text !== b[i].text);

  assert.equal(differing.length, 1);
  assert.equal(differing[0].id, "identify");
});

test("an unnamed clinic still produces a usable line", () => {
  const script = buildScript("   ");
  assert.match(script[1].text, /this clinic/);
});

test("recognises a refusal to deal with an automated caller", () => {
  for (const said of [
    "Sorry, we don't take automated calls.",
    "No AI please, have them call us.",
    "I'd rather speak to a human being.",
    "Please stop calling.",
  ]) {
    assert.ok(isRefusal(said), `should read as a refusal: ${said}`);
  }
});

test("an ordinary answer is not mistaken for a refusal", () => {
  for (const said of [
    "Yes, we're taking walk-ins today.",
    "No, we're appointment only today.",
    "Hard to say really, could be a while.",
  ]) {
    assert.ok(!isRefusal(said), `should not read as a refusal: ${said}`);
  }
});

test("recognises a phone tree rather than reading a script at it", () => {
  assert.ok(isIvr("For appointments, press 2. To return to the main menu, press 9."));
  assert.ok(!isIvr("Yes, we're taking walk-ins today."));
});

test("recognises an answering machine", () => {
  assert.ok(isVoicemail("Please leave a message after the tone."));
  assert.ok(isVoicemail("We're unable to take your call right now."));
  assert.ok(!isVoicemail("Good afternoon, clinic reception."));
});
