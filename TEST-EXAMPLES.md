# PetraRide — Try It Yourself

Six sentences to test the app live. Tap the mic, say the sentence (Arabic or English), and compare with the expected result.

> **Tips:** speak naturally, and wait about 10 seconds between requests. Nothing is ever booked until you tap **Confirm**.

---

### 1 · English · Vague place (confidence below 75%)

> **"I need a ride to the hospital"**

**Expected:** the app doesn't guess. It asks out loud and shows **5 hospitals**: Jordan University Hospital, Istiklal, Al-Khalidi, The Specialty Hospital, Jordan Hospital.
Tap one, or press "say instead" and speak it. The route and price appear right away.

---

### 2 · Arabic · Exact gate

> **«بدي اروح من مكة مول بوابة 2 على دوار صويلح»**

**Expected:** pickup **مكة مول • بوابة 2** (the exact entrance, not just the mall) → **دوار صويلح**. About 8 km, about 2.45 JOD.

---

### 3 · English · Between cities + ride type

> **"From Karak to the Dead Sea, comfort please"**

**Expected:** **Karak → Dead Sea**, about 97 km, with **Comfort** already selected. The app answers in English.

---

### 4 · Arabic · Vague place (confidence below 75%)

> **«بدي اروح على الجامعة»**

**Expected:** the app asks «أي جامعة حاب تروح عليها؟» and shows **5 universities**: الجامعة الأردنية، العلوم التطبيقية، البترا، الإسراء، الزيتونة.
No pickup was said, so the pickup is **your current location**.

---

### 5 · English · Family car

> **"Book a family car from Rainbow Street to the airport"**

**Expected:** **Rainbow Street → Queen Alia International Airport**, about 36 km, with **XL** selected automatically.

---

### 6 · Arabic · Across Jordan

> **«بدي اروح من الطفيلة على العقبة»**

**Expected:** **الطفيلة → العقبة**, about 206 km, about 52 JOD. Cities resolve to the town centre, not to a street with the same name.

---

## What each example shows

| # | Language | Feature |
|---|---|---|
| 1 | English | Asks when unsure (confidence < 0.75), 5 choices |
| 2 | Arabic | Gate-level precision |
| 3 | English | Intercity route + ride type from speech |
| 4 | Arabic | Asks when unsure + current location as pickup |
| 5 | English | "Family car" → XL |
| 6 | Arabic | Works across Jordan, not just Amman |

**Bonus (safety):** say something that isn't a ride, like «مرحبا كيفك». The app doesn't crash or book anything: it asks you to set a destination.
