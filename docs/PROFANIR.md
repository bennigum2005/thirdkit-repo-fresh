# Third Kit — A–Ö prófunarhandrit

Keyrt á localhost áður en farið er í hýsingu og alvöru greiðsluveitu.
Byggt á „Final sign-off" kaflanum í náms-bæklingnum + öllu sem við smíðuðum.

**Uppsetning fyrir prófun:**

- Tveir terminal-gluggar: annar keyrir `npm run dev` í `storefront/` (fær að
  vera í friði), hinn fyrir skipanir.
- Vafri á `http://localhost:3000` (athuga að serverinn segi 3000, ekki 3001 —
  þá er gamall server enn í gangi: `kill` hann).
- Haka við hvert atriði. Ef eitthvað fellur: skjáskot + lýsing til Claude.

---

## A · Grunnur

- [ ] `npm run dev` segir „Ready" án rauðra villna
- [ ] Forsíðan opnast; intro-myndbandið spilast og deyr yfir í vöruna
- [ ] „Sleppa →" hnappurinn virkar
- [ ] Endurhleðsla í sömu lotu: intro spilast EKKI aftur
- [ ] Lógóið er í miðju haussins, körfutáknið hægra megin

## B · Vörusíðan (skref 2–3)

- [ ] Verðið kemur úr Magento: 9.990 kr. fullorðins / 8.990 kr. barna
      (EKKI „Sýnigögn"-textinn — ef hann sést er .env.local ekki að lesa)
- [ ] Útgáfuskipti breyta verði, treyjumynd og stærðum
- [ ] Uppseldar stærðir eru yfirstrikaðar og ósmellanlegar (ef einhver er uppseld í Magento)
- [ ] Magn +/− virkar (1–10)
- [ ] „Setja í körfu" → hnappurinn sýnir „Komið í körfuna ✓", talan á körfutákninu hækkar, engin síðuskipti

## C · Karfan (skref 4)

- [ ] Körfutáknið opnar körfuna með réttum línum, stærðum og línuverði
- [ ] +/− breytir magni og samtölu (verð reiknuð af Magento)
- [ ] ✕ fjarlægir línu
- [ ] Karfan lifir af endurhleðslu (F5) — og af því að loka vafranum og opna aftur
- [ ] „Ganga frá pöntun" er læst þar til hakað er við skilmálana

## D · Afgreiðslan (skref 5–6)

- [ ] Tómt svæði stöðvar formið (vafrinn heimtar útfyllingu)
- [ ] Vitlaust netfang (t.d. „abc") → skýr villa
- [ ] Rétt útfyllt + „Áfram í afhendingu" → afhendingarvalið birtist
      (landshlutinn leysist sjálfkrafa úr póstnúmerinu — engin „Region"-villa)
- [ ] Afhendingarmátarnir koma úr Magento með verði — SKRÁÐU hvaða mátar birtast
- [ ] Dropp valið → „Veldu Dropp-afhendingarstað á korti" birtist; kortið opnast;
      valinn staður birtist með „Breyta"-hnappi
- [ ] „Áfram" er læst þar til Dropp-staður er valinn (þegar Dropp er valið)
- [ ] Heimsending valin → ekkert kort, beint áfram
- [ ] „← Breyta upplýsingum" fer til baka með formið óskert
- [ ] Samantektin sýnir sendingu + samtölu — og textann
      „Greiðsluleiðir í boði: …" → **SKJÁSKOT TIL CLAUDE** (Valitor-planið)

## E · Greiðslan í sandboxi (skref 7–8)

- [ ] „Greiða …kr." → sandbox-greiðslusíðan opnast með NÁKVÆMLEGA sömu upphæð
- [ ] „Hætta við" fer til baka í afgreiðsluna án pöntunar
- [ ] „Greiða (sandbox)" → staðfestingarsíðan sýnir ✓ og „SANDBOX-ÆFING"
- [ ] Körfutáknið er komið á núll eftir pöntun; forsíðan býður nýja körfu

## F · Final sign-off (bæklingurinn, kafli 9)

- [ ] **Heil pöntun** frá vörusíðu í staðfestingu í einni lotu — sjá E
- [ ] **Vafra lokað um leið og borgað er:** á sandbox-síðunni, smelltu „Greiða
      (sandbox)" og LOKAÐU flipanum samstundis. Opnaðu server-gluggann: þar á
      að standa `Webhook …: SIMULATED order …` — pöntunin varð til þótt
      vafrinn sæi aldrei staðfestinguna
- [ ] **Tvítekið webhook:** notaðu „Greiða + tvítekið webhook"-hnappinn.
      Server-loggurinn á að sýna EITT `SIMULATED order` og svo `Already processed`
      — ein pöntun þrátt fyrir tvö webhook
- [ ] **Magento úr sambandi:** breyttu MAGENTO_GRAPHQL_ENDPOINT í .env.local í
      vitlausa slóð (t.d. bættu „x" aftan á), endurræstu serverinn:
      síðan á að BIRTAST (sýnigögn/villuskilaboð) — ekki hanga í 30 sek.
      Settu rétta slóð aftur og endurræstu

## G · Villuvöktun (skref 9)

- [ ] `/kerfi/villur` opnast (tómt eða með eldri villum)
- [ ] `/api/villa-test` opnað í öðrum flipa → villan birtist á mælaborðinu
      innan mínútu (á að taka ~5 sek)

## H · Útlit

- [ ] Símabreidd (DevTools eða mjór gluggi): vörusíða, karfa, afgreiðsla og
      staðfesting raðast rétt og allt er smellanlegt
- [ ] Skilmálasíðan opnast af hlekknum í fæti og úr afgreiðslunni

---

## Eftir prófun — það sem enn þarf utanaðkomandi

1. **Greiðsluleiðalistinn** úr D → ræður Valitor/veitu-tengingunni
2. **Dropp Store ID** úr Magento admin (Stores → Configuration → Sales →
   Delivery Methods → Dropp) → í .env.local sem NEXT_PUBLIC_DROPP_STORE_ID
3. **Ein alvöru prufupöntun** með PLACE_REAL_ORDERS=true — Í SAMRÁÐI við
   rekstraraðila Jóa útherja; pöntunin svo afpöntuð í admin
4. **Hýsing** (t.d. Vercel) þegar allt ofangreint er grænt
