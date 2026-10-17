import { test } from "node:test";
import assert from "node:assert/strict";

test("currentTerm: January to May is Spring, June and July Summer, August to December Fall", async () => {
  const { currentTerm } = await import("../src/profile.ts");
  assert.equal(currentTerm(new Date(2026, 0, 10)), "Spring 2026");
  assert.equal(currentTerm(new Date(2026, 4, 31)), "Spring 2026");
  assert.equal(currentTerm(new Date(2026, 5, 1)), "Summer 2026");
  assert.equal(currentTerm(new Date(2026, 6, 31)), "Summer 2026");
  assert.equal(currentTerm(new Date(2026, 7, 1)), "Fall 2026");
  assert.equal(currentTerm(new Date(2026, 11, 31)), "Fall 2026");
});

test("shiftTerm and pickableTerms walk Spring, Summer, Fall across years; termSortKey orders them", async () => {
  const { shiftTerm, pickableTerms, termSortKey } = await import("../src/profile.ts");
  assert.equal(shiftTerm("Fall 2026", 1), "Spring 2027");
  assert.equal(shiftTerm("Spring 2026", -1), "Fall 2025");
  assert.equal(shiftTerm("Summer 2026", 2), "Spring 2027");
  assert.deepEqual(pickableTerms(new Date(2026, 9, 10)), ["Fall 2026", "Spring 2027", "Summer 2026"]);
  const sorted = ["Fall 2025", "Spring 2027", "Summer 2026", "Winter 2026", "Spring 2026"].sort((a, b) => termSortKey(a) - termSortKey(b));
  assert.deepEqual(sorted, ["Fall 2025", "Spring 2026", "Summer 2026", "Winter 2026", "Spring 2027"]);
});

test("groupClassesByTerm: this semester first, then newest; classes in the order they were added", async () => {
  const { groupClassesByTerm } = await import("../src/profile.ts");
  const c = (term, code, created_at) => ({ id: code, user_id: "u", term, code, title: null, created_at });
  const groups = groupClassesByTerm([c("Spring 2026", "CS 1428", "1"), c("Fall 2026", "MATH 3398", "3"), c("Fall 2026", "CS 3358", "2"), c("Spring 2027", "CS 4398", "4")], new Date(2026, 9, 10));
  assert.deepEqual(groups.map((g) => g.term), ["Fall 2026", "Spring 2027", "Spring 2026"]);
  assert.equal(groups[0].current, true);
  assert.deepEqual(groups[0].classes.map((x) => x.code), ["CS 3358", "MATH 3398"]);
});

test("class codes are tidied like the database does and checked", async () => {
  const { normalizeClassCode, classCodeProblem } = await import("../src/profile.ts");
  assert.equal(normalizeClassCode(" cs3358 "), "CS 3358");
  assert.equal(normalizeClassCode("math   3398"), "MATH 3398");
  assert.equal(normalizeClassCode("Phys 1315L"), "PHYS 1315L");
  assert.equal(classCodeProblem("CS 3358"), null);
  assert.match(classCodeProblem("C"), /2 to 16/);
  assert.match(classCodeProblem("CS 3358!"), /letters and numbers/);
});

test("sections and course chat names: trimmed and upper-cased, checked like the database, named like it", async () => {
  const { normalizeClassSection, classSectionProblem, courseChatName } = await import("../src/profile.ts");
  assert.equal(normalizeClassSection(" 001 "), "001");
  assert.equal(normalizeClassSection("a"), "A");
  assert.equal(classSectionProblem("001"), null);
  assert.equal(classSectionProblem("A-1"), null);
  assert.match(classSectionProblem(""), /1 to 10/);
  assert.match(classSectionProblem("12345678901"), /1 to 10/);
  assert.match(classSectionProblem("00 1"), /letters and numbers/);
  assert.match(classSectionProblem("-1"), /letters and numbers/);
  assert.equal(courseChatName("CS 3358", "001", "Fall 2026"), "CS 3358-001 · Fall 2026");
});

test("meeting times: parsed from JSON leniently, checked like the database, read as MWF 10:00–10:50 AM", async () => {
  const { parseClassMeetings, meetingsProblem, locationProblem, formatClockTime, formatClassMeeting, formatClassMeetings, weekdayLetters, classDetails } = await import("../src/profile.ts");
  assert.deepEqual(parseClassMeetings([{ days: ["fri", "mon", "nope", "wed"], start: "10:00", end: "10:50" }, "junk", { days: "mon" }]), [{ days: ["mon", "wed", "fri"], start: "10:00", end: "10:50" }]);
  assert.deepEqual(parseClassMeetings(null), []);
  assert.equal(meetingsProblem([]), null);
  assert.equal(meetingsProblem([{ days: ["tue", "thu"], start: "11:00", end: "12:20" }]), null);
  assert.match(meetingsProblem([{ days: [], start: "11:00", end: "12:20" }]), /at least one day/);
  assert.match(meetingsProblem([{ days: ["mon"], start: "", end: "12:20" }]), /start and an end/);
  assert.match(meetingsProblem([{ days: ["mon"], start: "12:20", end: "11:00" }]), /after the start/);
  assert.match(meetingsProblem([{ days: ["mon"], start: "09:00", end: "10:00" }, { days: ["tue"], start: "10:00", end: "09:00" }]), /^Meeting time 2: /);
  assert.match(meetingsProblem(Array.from({ length: 5 }, () => ({ days: ["mon"], start: "09:00", end: "10:00" }))), /up to 4/);
  assert.equal(locationProblem(" Derrick Hall 240 "), null);
  assert.match(locationProblem("x".repeat(81)), /at most 80/);
  assert.equal(formatClockTime("00:30"), "12:30 AM");
  assert.equal(formatClockTime("12:00"), "12:00 PM");
  assert.equal(formatClockTime("13:05"), "1:05 PM");
  assert.equal(weekdayLetters(["thu", "tue"]), "TTh");
  assert.equal(formatClassMeeting({ days: ["mon", "wed", "fri"], start: "10:00", end: "10:50" }), "MWF 10:00–10:50 AM");
  assert.equal(formatClassMeeting({ days: ["tue", "thu"], start: "11:00", end: "12:20" }), "TTh 11:00 AM–12:20 PM");
  assert.equal(formatClassMeetings([{ days: ["mon"], start: "09:00", end: "09:50" }, { days: ["sat"], start: "14:00", end: "16:00" }]), "M 9:00–9:50 AM · Sa 2:00–4:00 PM");
  assert.equal(classDetails({ section: "001", meetings: [{ days: ["mon", "wed", "fri"], start: "10:00", end: "10:50" }], location: "Derrick Hall 240" }), "Section 001 · MWF 10:00–10:50 AM · Derrick Hall 240");
  assert.equal(classDetails({ section: null, meetings: [], location: null }), "");
});

test("usernames: tidied and checked by the same rules as the database", async () => {
  const { normalizeUsername, usernameProblem } = await import("../src/profile.ts");
  assert.equal(normalizeUsername(" @Crf153 "), "crf153");
  assert.equal(usernameProblem("crf153"), null);
  assert.equal(usernameProblem("sunil.sherpa_26"), null);
  for (const bad of ["ab", ".sunil", "sunil.", "sun..il", "sun_.il", "sunil!", "a".repeat(31)]) assert.ok(usernameProblem(bad), bad);
});

test("visibility wording for owners and visitors", async () => {
  const { ownSectionNote, lockedSectionMessage, visibilityLabel, isProfileVisibility, PROFILE_VISIBILITY_OPTIONS } = await import("../src/profile.ts");
  assert.deepEqual(PROFILE_VISIBILITY_OPTIONS.map((o) => o.label), ["Everyone", "Friends", "Only me"]);
  assert.equal(visibilityLabel("friends"), "Friends");
  assert.equal(ownSectionNote("saved", "private"), "Only you can see your saved posts");
  assert.equal(ownSectionNote("classes", "friends"), "Your friends can see your classes");
  assert.equal(lockedSectionMessage("liked", "private", "Sunil"), "Only Sunil can see their liked posts");
  assert.equal(lockedSectionMessage("classes", "friends", "Sunil"), "Only Sunil's friends can see their classes");
  assert.ok(isProfileVisibility("public") && !isProfileVisibility("followers"));
});

test("follower lists: the owner gets their own, anyone else signed in the mutual friends, signed out a prompt", async () => {
  const { followListView, privateFollowListsNote, noMutualFriendsMessage, MUTUAL_FRIENDS_TITLE, MUTUAL_FRIENDS_LOGIN_PROMPT } = await import("../src/profile.ts");
  assert.equal(followListView("u1", "u1"), "own");
  assert.equal(followListView("u2", "u1"), "mutual");
  assert.equal(followListView(null, "u1"), "signed-out");
  assert.equal(followListView(undefined, "u1"), "signed-out");
  assert.equal(followListView("", "u1"), "signed-out");
  assert.equal(MUTUAL_FRIENDS_TITLE, "Mutual friends");
  assert.equal(MUTUAL_FRIENDS_LOGIN_PROMPT, "Log in to see mutual friends");
  assert.equal(privateFollowListsNote("Sunil"), "Only Sunil can see their followers and following");
  assert.equal(privateFollowListsNote(" "), "Followers and following are private");
  assert.equal(noMutualFriendsMessage("Sunil "), "You and Sunil have no friends in common yet");
  assert.equal(noMutualFriendsMessage(""), "No friends in common yet");
});

test("grid tiles: posts and reels with their first picture, views and pins; listings link to their page", async () => {
  const { tileFromFeedPost, tileFromListing, sortPinnedFirst } = await import("../src/profile.ts");
  const photo = { type: "photo", url: "https://img/1.jpg", width: 1, height: 1, blur: null };
  const video = { type: "video", playbackUrl: "https://s/v.m3u8", poster: "https://img/p.jpg", width: 1, height: 1, durationSeconds: 3 };
  const t = tileFromFeedPost({ id: "p1", kind: "post", body: " hi ", pinned_at: "2026-10-01" }, [photo, photo], 2400);
  assert.deepEqual([t.type, t.href, t.imageUrl, t.text, t.isVideo, t.multiPhoto, t.pinned, t.views], ["post", "/posts/p1", "https://img/1.jpg", "hi", false, true, true, 2400]);
  const r = tileFromFeedPost({ id: "r1", kind: "reel", body: "", pinned_at: null }, [video]);
  assert.deepEqual([r.type, r.imageUrl, r.isVideo, r.text, r.views], ["reel", "https://img/p.jpg", true, null, null]);
  const words = tileFromFeedPost({ id: "w1", kind: "post", body: "Just words", pinned_at: null }, []);
  assert.deepEqual([words.imageUrl, words.text], [null, "Just words"]);
  const item = tileFromListing("item", { id: "i1", title: "Desk lamp" }, [photo]);
  assert.deepEqual([item.type, item.href, item.text, item.views], ["item", "/marketplace/i1", "Desk lamp", null]);
  const order = sortPinnedFirst([
    { id: "old", pinned_at: null, created_at: "2026-01-01" },
    { id: "pinA", pinned_at: "2026-09-01", created_at: "2025-01-01" },
    { id: "new", pinned_at: null, created_at: "2026-10-01" },
    { id: "pinB", pinned_at: "2026-09-05", created_at: "2025-02-01" },
  ]).map((p) => p.id);
  assert.deepEqual(order, ["pinB", "pinA", "new", "old"]);
});
