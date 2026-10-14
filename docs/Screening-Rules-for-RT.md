# Candidate Screening — How Candidates Are Found and Ranked

**Screen:** Candidate Screening (left sidebar) · **For:** the Recruitment Team · **Date:** 2026-10-14

This page explains, in plain words, **why a candidate is or is not shown** on the
Candidate Screening screen, and **why they appear in the order they do**. It covers
both tabs: **JD Filtering** and **Keyword Filtering**.

These rules apply from the release that switches on the new screening. Until then
the screen behaves as before.

---

## The two ideas behind everything

1. **Filters decide who appears. The score only decides the order.**
   If a candidate meets every condition you set, they are shown, however low their
   score. A low score moves them down the list; it never hides them.

2. **Every condition is strict, and a blank counts as "does not meet it".**
   If you ask for experience of 2 to 6 years, a candidate whose experience was
   never recorded is **not** shown. They are not given the benefit of the doubt,
   because we cannot tell whether they qualify.

   This is the most common reason a candidate you expected is missing: the field
   you filtered on is empty on their profile. Fill it in on the candidate's record
   and they will appear.

**"0" is a real value.** Minimum experience 0 means "freshers are welcome"; it
still needs the experience to be recorded (as 0).

---

## How a skill is matched

The same rule is used on both tabs.

- **Whole words only.** "Java" finds Java but **not** JavaScript. "Go" does not
  find "Django". "C" does not find "C#" or "C++". "Kafka" does not find "Kafkaesque".
- **Common spellings count as the same skill.** For example:

  | You type | Also finds |
  |---|---|
  | .NET | dotnet, dot net, ASP.NET, .NET Core |
  | C# | csharp, c sharp |
  | C++ | cpp |
  | Node.js | nodejs, node js, node |
  | JavaScript | js |
  | React | react.js, reactjs |
  | Angular | angular.js, angularjs |
  | Vue | vue.js, vuejs |
  | PostgreSQL | postgres |
  | Kubernetes | k8s |

  If you notice another pair that recruiters and resumes use interchangeably, tell
  the ATS team and it can be added.
- **Where we look.** A skill counts if it appears in any of three places:
  1. the candidate's **skills list** (their declared top skills),
  2. the **keywords picked out of their resume** when it was uploaded,
  3. the **full text of their resume**.

  A skill in the skills list is the strongest evidence. A skill that appears only
  somewhere in the resume text still counts, but it ranks a little lower.
- **Upper or lower case does not matter**, and nor do extra spaces or a hyphen in
  place of a space ("Spring Boot", "spring-boot").

---

## Keyword Filtering tab

### Finding one specific person

The **Candidate name**, **Email** and **Phone** boxes look up one person directly.
When you use one of them, **every other filter is ignored**, because you already
know who you want. These lookups also show people who were recently rejected.

| Box | How it matches |
|---|---|
| **Candidate name** | The exact full name; capitals and extra spaces do not matter. If no one has exactly that name, you see the names that **start with** what you typed. |
| **Email** | The exact address. A candidate with several addresses on file is found by any of them. |
| **Phone** | The last 10 digits, whatever the formatting (+91, spaces, dashes). Type the full 10-digit number. |

### The filters

| Filter | What it means | When the candidate's value is blank |
|---|---|---|
| **Skills** | The candidate must have **every** skill you type (comma-separated). Tick **Match any one skill** to accept candidates with at least one of them. | — |
| **Location** | Each city you add must match one of the places on the candidate's profile **exactly**. "Noida" matches "Noida, UP" and "Noida (UP)" but **not** "Greater Noida". Add several cities to accept any of them. | Not shown |
| **Position applied for** | The position on their application must contain the whole phrase. "Java Developer" does not match "JavaScript Developer". | Not shown |
| **Gender** | Male or female. | Not shown |
| **Experience (years)** | Total experience between the min and max you enter (both included). You can fill just one. | Not shown |
| **Expected CTC (LPA)** | Expected CTC between the min and max you enter. | Not shown |
| **Notice period** | Notice of at most the days chosen. "Immediate" means 0 days. | Not shown |
| **Added within** | Uploaded in the last 7 / 15 / 30 / 90 days. | — |
| **Education / Qualification** | The candidate must fit at least one ticked category. | Not shown |

Two more rules:
- **Recently rejected** candidates (rejected for any role in the last **90 days**)
  are left out.
- A search with **no filter at all** is refused. It would return the whole database.

### The summary line

Above the results you see, for example:

> **24 matched** (98,412 searched; removed by location 61,203, experience 9,870, expected CTC 4,112, skills 23,203)

Each "removed by" number is how many candidates **that** filter took out, counting
in the order shown. The numbers always add up: 24 + 61,203 + 9,870 + 4,112 + 23,203
= 98,412.

### The order (keyword score)

Every candidate shown gets a score out of 10:

- **Skill match (80%).** How many of your skills they have, weighted by where each
  was found: skills list 100%, resume keywords 85%, resume text only 70%.
- **Job stability (20%).** Their longest stay at one employer compared with their
  total experience, when their employment history is known. When it is not, the
  score is skill match alone.

With no skills typed, job stability alone orders the list. Equal scores are broken
by more skills in the skills list, then by how closely the resume matches the
search as a whole, then by newest upload.

---

## JD Filtering tab

Choose an open role. The search reads the role's MRF and applies four checks.
**A candidate must pass all four.** The role card shows exactly what was checked.

### The four checks

**1. Mandatory skills: all of them.**
The candidate must have **every** mandatory skill on the MRF, matched as described
above.

The MRF's text is tidied before it is used, so it reads the way a recruiter means it:

| MRF text | Skills checked |
|---|---|
| Strong knowledge of Java | Java |
| Hands-on experience with Spring Boot | Spring Boot |
| React and Redux | React **and** Redux (both required) |
| Python (Django/Flask) | Python (the brackets are treated as examples) |
| CI/CD, PL/SQL | CI/CD and PL/SQL, each kept as one skill |
| Good communication skills | not checked (a soft skill) |
| 3+ years of experience | not checked (the experience check covers it) |
| Java or Kotlin | not checked ("either/or" cannot be required) |

The role card lists the skills that are actually checked under **Mandatory skills —
Candidates must have all of these**.

If the MRF says "Same as JD", the skills come from the JD document. If it says
"Other", they come from the "Other" text.

**If no checkable skill is left** (for example, the MRF lists only soft skills),
**no candidates are shown** and the screen asks you to edit the MRF. Showing
everyone with the right experience would not be a match.

**2. Education.** Taken from the MRF's *Desired Qualification*. "Any" means any
**branch or stream**, not any degree:

| MRF says | Candidate needs |
|---|---|
| BE/BTech, MCA, Any | a BE/BTech or MCA, in any branch |
| PG, Any | any post-graduate degree |
| Graduate | any degree |
| Other, or blank | not checked |

A candidate with no degree recorded is not shown when education is checked.

**3. Budget.** Expected CTC must be **at or below** the budget on the role's MRF
request. If the request has no budget, CTC is not checked and the role card shows
**Budget: Not set — Expected CTC is not checked**.

**4. Experience.** Total experience must fall in the range from the JD, for example
3 – 6 years, both ends included. If the JD gives no range, the MRF's years are the
minimum and there is no maximum (the card then shows "3 yrs or more"). There is
no tolerance: 2.9 years is outside a 3 – 6 range.

As on the keyword tab, candidates **rejected for this role** in the last **90 days**
are left out.

### The summary line

> **24 matched** of 98,412 · 1,240 meet education, budget and experience · of those, 24 have all 3 mandatory skills

Only the checks this MRF applies are named. If there is no budget, the line says
"no budget on this MRF, CTC not checked".

### The order (JD score)

Only candidates who pass all four checks are scored. The score is out of 10:

| Part | Weight | Highest when… |
|---|---|---|
| **Mandatory skill coverage** | 60% | every mandatory skill is in their skills list (a skill found only in the resume counts 70%) |
| **Experience fit** | 20% | their experience is in the **middle** of the range; the two ends score half. With no maximum, anyone up to 2 years above the minimum scores full, easing to half at 6 years above. |
| **CTC headroom** | 10% | their expected CTC leaves the most room under the budget (no budget: the same for everyone) |
| **Notice period** | 10% | they can join soonest: up to 15 days is best, more than 60 days (or not recorded) is lowest |

Equal scores are broken by more skills in the skills list, then by how closely the
resume matches the JD as a whole, then by newest upload.

These weights are a starting point. They will be reviewed with the Recruitment Team
after the first weeks of real use.

### What the AI does (and does not do)

- The AI writes the **summary, fit verdict, red flags and skill gap** you see in
  the candidate drawer, for the top 10 candidates. These are written for **this
  role**, so a summary written for another role is never reused here.
- The AI **does not decide who is shown or the score**. Both come only from the
  rules on this page.
- If the AI service is down, results still appear, with an **AI insights
  unavailable** tag.
- When the MRF says "Same as JD", the skills and the experience range come from the
  JD document, which the AI read when it was uploaded. Check the role card: if it
  shows something the JD did not mean, correct the MRF.

---

## Stars

Both tabs turn the score into stars:

| Score | Stars | Label |
|---|---|---|
| 9 – 10 | ★★★★★ | Excellent fit |
| 7 – 8.9 | ★★★★ | Strong candidate |
| 5 – 6.9 | ★★★ | Moderate fit |
| 3 – 4.9 | ★★ | Weak fit |
| below 3 | ★ | Poor fit |

On the keyword tab, **Strong** = 4–5 stars, **Moderate** = 3 stars and **Weak** = 1–2 stars.

---

## Worked examples

These use sample candidates to show how the rules play out.

### Example 1 — Keyword search: Java, Spring · Location Noida · Expected CTC up to 12

| Candidate | Profile | Shown? | Why |
|---|---|---|---|
| Asha | Skills: Java, Spring, Hibernate · Noida, UP · expects 10 LPA | **Yes** | Has both skills, Noida is one of her places, CTC within 12 |
| Rohit | Skills: JavaScript, React · Noida · expects 9 LPA | No | JavaScript is not Java, and he has no Spring |
| Neha | Skills: Java, Spring Boot · Greater Noida · expects 11 LPA | No | "Greater Noida" is not "Noida" |
| Vikram | Skills: Java, Spring · Noida · expected CTC **blank** | No | Expected CTC was filtered and his is not recorded |

To include Vikram, record his expected CTC. To include Neha, add "Greater Noida"
as a second location.

### Example 2 — JD search: Senior Kafka Engineer

MRF: mandatory skills "Strong knowledge of Java, Spring Boot, Kafka, Good
communication skills" · Qualification "BE/BTech, MCA, Any" · Experience 3 – 6
years (from the JD) · Budget 15 LPA.

Checked skills: **Java, Spring Boot, Kafka**. "Good communication skills" is a
soft skill and is not checked.

| Candidate | Profile | Shown? | Why |
|---|---|---|---|
| Asha | All three skills · B.Tech · 4.5 yrs · expects 12 LPA | **Yes** | Passes all four checks |
| Ravi | Java, Spring Boot listed; Kafka in resume text · MCA · 6 yrs · expects 14 LPA | **Yes** | Kafka in the resume counts; 6 years is inside 3 – 6 |
| Meera | Java, Spring Boot only · B.Tech · 5 yrs · expects 11 LPA | No | Missing Kafka |
| Karan | All three skills · **B.Com** · 4 yrs · expects 10 LPA | No | B.Com is not BE/BTech or MCA |
| Priya | All three skills · B.Tech · 5 yrs · expects **18** LPA | No | Over the 15 LPA budget |
| Arjun | All three skills · B.Tech · **0** yrs (fresher) · expects 6 LPA | No | Below the 3 – 6 years range |

### Example 3 — Why Asha ranks above Ravi (same role)

| | Asha | Ravi |
|---|---|---|
| Skill coverage (60%) | all 3 in skills list → 100% | 2 in skills list, Kafka only in resume → 90% |
| Experience fit (20%) | 4.5 yrs, the middle of 3 – 6 → 100% | 6 yrs, the top end → 50% |
| CTC headroom (10%) | 12 of 15 LPA → 20% room | 14 of 15 LPA → about 7% room |
| Notice (10%) | 15 days → 100% | 60 days → 40% |
| **Score** | **9.2 → ★★★★★** | **6.9 → ★★★** |

Both are shown, because both pass every check. The score only puts Asha first.

---

## "Why isn't this candidate showing?" — a checklist

1. **Is a field you filtered on blank on their profile?** Open the candidate and
   check experience, expected CTC, notice period, location, gender and degree. This
   is the most common reason.
2. **Is the skill spelt differently on their resume?** For example "ReactJS" vs
   "React" is covered, but a misspelling like "Sprng" is not.
3. **Were they rejected recently?** Candidates rejected in the last 90 days are left
   out (for any role on the keyword tab, for this role on the JD tab). Search them
   by name to see them anyway.
4. **JD tab: check the role card.** It shows exactly which skills, experience range,
   budget and qualification were applied. If one of them is wrong, correct the MRF.
5. **Location: is it the exact city?** "Noida" does not include "Greater Noida".

If none of these explains it, send the candidate's name and the search you ran to
the ATS team.
