import { test } from "node:test";
import assert from "node:assert/strict";

test("campusShortName: well-known codes win, by email domain (subdomains and stray spacing too) or by name", async () => {
  const { campusShortName } = await import("../src/campus.ts");
  assert.equal(campusShortName({ name: "Texas State University", email_domain: "txstate.edu" }), "TXST");
  assert.equal(campusShortName({ name: "Texas State University", email_domain: null }), "TXST", "items carry the name only");
  assert.equal(campusShortName({ name: "  texas   state university " }), "TXST");
  assert.equal(campusShortName({ name: "Texas State", email_domain: " @Bobcats.TXState.EDU. " }), "TXST");
  assert.equal(campusShortName({ name: "University of Texas at Austin" }), "UT", "not UTA, which is UT Arlington");
  assert.equal(campusShortName({ name: "Texas State University", email_domain: "asu.edu" }), "ASU", "the domain decides before the name");
});

test("campusShortName: the institution's label of the email domain when it has at most five letters", async () => {
  const { campusShortName } = await import("../src/campus.ts");
  assert.equal(campusShortName({ name: "Arizona State University", email_domain: "asu.edu" }), "ASU");
  assert.equal(campusShortName({ name: "University of California, Los Angeles", email_domain: "ucla.edu" }), "UCLA");
  assert.equal(campusShortName({ name: "University of Michigan", email_domain: "umich.edu" }), "UMICH");
  assert.equal(campusShortName({ name: "National University of Singapore", email_domain: "nus.edu.sg" }), "NUS", "edu.sg is skipped");
  assert.equal(campusShortName({ name: "University of Oxford", email_domain: "ox.ac.uk" }), "OX", "ac.uk is skipped");
  assert.equal(campusShortName({ name: "University of North Texas", email_domain: "my.unt.edu" }), "UNT", "a mail subdomain is skipped");
  // Longer labels fall through to the name.
  assert.equal(campusShortName({ name: "Imperial College London", email_domain: "imperial.ac.uk" }), "ICL");
  assert.equal(campusShortName({ name: "University of Melbourne", email_domain: "student.unimelb.edu.au" }), "UM");
  assert.equal(campusShortName({ name: "Northwestern University", email_domain: "u.northwestern.edu" }), "NU", "never the one-letter subdomain");
  assert.equal(campusShortName({ name: "Rutgers University", email_domain: "scarletmail.rutgers.edu" }), "RU");
});

test("campusShortName: otherwise the initials of the name's significant words", async () => {
  const { campusShortName } = await import("../src/campus.ts");
  assert.equal(campusShortName({ name: "Imperial College London" }), "ICL");
  assert.equal(campusShortName({ name: "University of California, Los Angeles" }), "UCLA");
  assert.equal(campusShortName({ name: "University of Texas at San Antonio" }), "UTSA");
  assert.equal(campusShortName({ name: "Massachusetts Institute of Technology" }), "MIT");
  assert.equal(campusShortName({ name: "Texas A&M University" }), "TAMU", "& splits a word");
  assert.equal(campusShortName({ name: "King’s College London" }), "KCL", "apostrophes are ignored");
  assert.equal(campusShortName({ name: "King's College London" }), "KCL");
  assert.equal(campusShortName({ name: "IIT Delhi" }), "IITD", "an acronym in the name stays whole");
  assert.equal(campusShortName({ name: "École Polytechnique Fédérale de Lausanne" }), "EPFL", "accents dropped, de skipped");
  assert.equal(campusShortName({ name: "Universidad Nacional Autónoma de México" }), "UNAM");
  assert.equal(campusShortName({ name: "Pontifícia Universidade Católica do Rio de Janeiro" }), "PUCRJ");
  assert.equal(campusShortName({ name: "Universidade Federal do Rio Grande do Sul, Campus Porto Alegre" }), "UFRGSC", "capped at six letters");
  assert.equal(campusShortName({ name: "Harvard" }), "HARVARD", "a one-word name is shown whole");
});

test("campusShortName: nothing to go on gives an empty string", async () => {
  const { campusShortName } = await import("../src/campus.ts");
  assert.equal(campusShortName(null), "");
  assert.equal(campusShortName(undefined), "");
  assert.equal(campusShortName({}), "");
  assert.equal(campusShortName({ name: "  ", email_domain: "edu" }), "", "a bare suffix is not a domain");
  assert.equal(campusShortName({ name: "of the", email_domain: "" }), "", "only minor words");
});
