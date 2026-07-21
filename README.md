# Third Kit

Vefverslun Third Kit — svört og gyllt síða með einni vöru í tveimur útgáfum
(fullorðins og barna), tengd Microsoft Dynamics 365 Business Central fyrir
lagerstöðu og sölupantanir.

## Uppbygging

```
site/           Vefsíðan sjálf (statísk — má hýsa hvar sem er)
  index.html        Forsíða með vali: Fullorðins / Barna
  fullordins.html   Vörusíða fullorðins (stærðir XS–XXL)
  barna.html        Vörusíða barna (stærðir 110–176)
  skilmalar.html    Skilmálar
middleware/     Azure Function — millilag milli vefsins og Business Central
  src/functions/availability.js   GET /api/availability — lagerstaða á stærð
  src/functions/order.js          POST /api/order — webhook frá greiðslusíðu,
                                  býr til sölupöntun í BC
docs/           Uppsetningarleiðbeiningar
  GUIDE.md            Heildaruppsetning skref fyrir skref
  ADMIN-CHECKLIST.md  Gátlisti fyrir admin-aðganginn
```

## Stillingar sem á eftir að fylla inn

Í `site/fullordins.html` og `site/barna.html` (CONFIG-blokkin neðst í skránni):

- `PRICE` — verð vörunnar
- `CHECKOUT_URL` — hlekkur á greiðslusíðu samstarfsaðila
- `AVAILABILITY_URL` — slóð á availability-endapunkt middleware-sins

Í `site/skilmalar.html`: gylltu textarnir (nafn fyrirtækis, kennitala,
heimilisfang, netfang, sendingaraðili).

Middleware-stillingar (umhverfisbreytur í Azure) eru útskýrðar í
`docs/GUIDE.md`, fasa 3. **Engin leyndarmál eiga heima í þessu repo-i** —
client secret og webhook secret fara eingöngu í stillingar Function App.

## Hýsing

`site/` mappan er hrein statísk síða — GitHub Pages, Cloudflare Pages, Netlify
eða hefðbundin hýsing virkar. Hafið allar fjórar HTML-skrárnar í sömu möppu.
