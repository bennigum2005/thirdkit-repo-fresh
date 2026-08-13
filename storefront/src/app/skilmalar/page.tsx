// Skilmálar — static content, server component, no JS shipped.
import Link from "next/link";

export const metadata = { title: "Third Kit — Skilmálar" };

const SECTIONS: Array<{ title: string; body: string[] }> = [
  {
    title: "1. Almennt",
    body: [
      "Skilmálar þessir gilda um öll kaup á vörum í vefverslun Third Kit. Með því að ganga frá pöntun samþykkir kaupandi skilmálana eins og þeir eru á þeim tíma sem kaup fara fram.",
      "Seljandi er [NAFN FYRIRTÆKIS], kt. [KENNITALA], [HEIMILISFANG]. Fyrirspurnir berist á [NETFANG].",
    ],
  },
  {
    title: "2. Vörur og verð",
    body: [
      "Öll verð eru birt í íslenskum krónum og innihalda virðisaukaskatt. Verð geta breyst án fyrirvara, en pöntun er alltaf gerð á því verði sem birt var þegar hún var staðfest.",
      "Fyrirvari er gerður um innsláttarvillur í verðum og vörulýsingum sem og að vörur geti selst upp.",
    ],
  },
  {
    title: "3. Pöntun og greiðsla",
    body: [
      "Greiðsla fer fram á öruggri greiðslusíðu samstarfsaðila okkar. Third Kit geymir ekki og hefur ekki aðgang að greiðslukortaupplýsingum kaupanda.",
      "Pöntun telst staðfest þegar greiðsla hefur borist og staðfesting verið send á netfang kaupanda.",
    ],
  },
  {
    title: "4. Afhending",
    body: [
      "Vörur eru sendar með [SENDINGARAÐILI] og er afhendingartími að jafnaði [X–X virkir dagar] frá staðfestingu pöntunar. Sendingarkostnaður kemur fram við frágang kaupa.",
      "Tafir sem rekja má til flutningsaðila eru á ábyrgð hans, en Third Kit aðstoðar kaupanda við að leysa úr slíkum málum eftir bestu getu.",
    ],
  },
  {
    title: "5. Skilaréttur",
    body: [
      "Í samræmi við lög um neytendasamninga nr. 16/2016 hefur kaupandi 14 daga frest frá móttöku vöru til að falla frá kaupum án þess að tilgreina ástæðu. Tilkynning um skil skal send á [NETFANG] innan frestsins.",
      "Vara skal vera ónotuð, í upprunalegu ástandi og með öllum merkimiðum. Kaupandi ber kostnað af því að senda vöru til baka nema annað sé tekið fram. Endurgreiðsla fer fram innan 14 daga frá því að varan berst okkur, með sama greiðslumáta og notaður var við kaupin.",
    ],
  },
  {
    title: "6. Stærðarskipti",
    body: [
      "Óski kaupandi eftir að skipta í aðra stærð skal hafa samband á [NETFANG] innan 14 daga frá móttöku. Skipti eru háð því að umbeðin stærð sé til á lager. Varan skal vera ónotuð og með merkimiðum.",
    ],
  },
  {
    title: "7. Gallar og kvartanir",
    body: [
      "Um galla fer samkvæmt lögum um neytendakaup nr. 48/2003. Reynist vara gölluð á kaupandi rétt á nýrri vöru, viðgerð, afslætti eða endurgreiðslu eftir atvikum. Kvartanir vegna galla skal senda á [NETFANG] ásamt mynd og lýsingu á gallanum og númeri pöntunar.",
      "Third Kit ber ekki ábyrgð á skemmdum sem rekja má til rangrar meðferðar, svo sem þvotts sem ekki samræmist þvottaleiðbeiningum.",
    ],
  },
  {
    title: "8. Persónuvernd",
    body: [
      "Third Kit vinnur einungis með þær persónuupplýsingar sem nauðsynlegar eru til að afgreiða pöntun, í samræmi við lög nr. 90/2018 um persónuvernd og vinnslu persónuupplýsinga. Upplýsingarnar eru ekki seldar eða afhentar þriðja aðila nema að því marki sem nauðsynlegt er til að afhenda vöruna eða lög krefjast.",
      "Greiðsluupplýsingar eru meðhöndlaðar af greiðslusíðu samstarfsaðila okkar og lúta persónuverndarstefnu hans.",
    ],
  },
  {
    title: "9. Ábyrgð",
    body: [
      "Ábyrgð Third Kit takmarkast við kaupverð vörunnar. Third Kit ber ekki ábyrgð á óbeinu eða afleiddu tjóni sem rekja má til notkunar vöru eða tafa á afhendingu, að því marki sem lög heimila.",
    ],
  },
  {
    title: "10. Breytingar á skilmálum",
    body: [
      "Third Kit áskilur sér rétt til að breyta skilmálum þessum. Breytingar taka gildi við birtingu á þessari síðu og gilda um kaup sem gerð eru eftir birtingu.",
    ],
  },
  {
    title: "11. Lög og ágreiningur",
    body: [
      "Um skilmála þessa gilda íslensk lög. Rísi ágreiningur um viðskipti skal fyrst leitast við að leysa hann í samráði við kaupanda. Náist ekki sátt getur kaupandi beint kvörtun til Kærunefndar vöru- og þjónustukaupa eða borið málið undir Héraðsdóm Reykjavíkur.",
    ],
  },
];

export default function Skilmalar() {
  return (
    <div className="max-w-[760px] mx-auto px-[6vw] pt-32 pb-24">
      <Link href="/" className="inline-block mb-7 text-[0.75rem] tracking-[0.22em] uppercase" style={{ color: "var(--muted)" }}>
        ← Til baka
      </Link>
      <h1 className="uppercase font-extrabold tracking-[0.12em] text-3xl mb-2">
        Skil<span style={{ color: "var(--gold)" }}>málar</span>
      </h1>
      <p className="text-[0.78rem] tracking-[0.1em] mb-10" style={{ color: "var(--muted)" }}>
        Síðast uppfært: 12. ágúst 2026
      </p>
      {SECTIONS.map((s) => (
        <section key={s.title} className="mb-8">
          <h2 className="text-[0.95rem] font-bold tracking-[0.2em] uppercase pb-2 mb-3 border-b"
            style={{ color: "var(--gold)", borderColor: "rgba(212,175,55,.18)" }}>
            {s.title}
          </h2>
          {s.body.map((p, i) => (
            <p key={i} className="text-[0.95rem] leading-[1.8] mb-2.5" style={{ color: "#cfcabb" }}>{p}</p>
          ))}
        </section>
      ))}
    </div>
  );
}
