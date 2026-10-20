# World of Vikings – automatisk nettbutikk

## Hva er gjort?

- 236 navngitte enkeltmerker + album og klistremerkepakke.
- Bestillinger sendes automatisk fra nettleseren til serveren; kundens e-postprogram brukes ikke.
- Hver bestilling får ordrenummer og lagres i SQLite-databasen.
- Lageret trekkes fra **atomisk** ved registrert ordre. Hvis en vare ikke er på lager, blir bestillingen avvist. Kansellerte ordre får lageret tilbake.
- Serveren beregner vareprisene selv, med 50 kr fast porto per ordre. Kundene kan ikke endre prisene ved å endre HTML.
- E-postvarsel til **mrkassimaja@gmail.com** via SMTP når dette er konfigurert. Ordrene lagres selv om varsling mislykkes.
- Ingen betaling på nettsiden. Selger sender Vippskrav manuelt.

## Slik starter du lokalt på Windows

1. Installer **Node.js 22.13 eller nyere** (helst siste LTS-versjon).
2. Pakk ut filen og åpne Kommandoprompt / PowerShell i denne mappen.
3. Kjør `npm install` (for e-postbiblioteket nodemailer).
4. Sett en sterk administrasjonsnøkkel med minst 20 tegn: i PowerShell ` $env:ADMIN_KEY="VELG-EN-LANG-TILFELDIG-HEMMELIG-NOKKEL" `.
5. Kjør `npm start`.
6. Åpne **http://localhost:3000** for butikken og **http://localhost:3000/admin** for administrasjon.
7. Logg inn med administrasjonsnøkkelen. Sett lager og pris på album/pakker, og faktisk antall av hvert enkeltmerke. Pris for enkeltmerker er 10 kr som standard; startlager er **0** for alle varer for å hindre at noe blir solgt ved en feil.

En ZIP-fil med HTML kan ikke alene gi automatisk ordremottak og felles lager: **serveren må kjøre hele tiden**. Nettbutikken kan ikke driftes som bare en statisk `index.html`.

## E-postvarsler

Du må knytte serveren til en SMTP-tjeneste med lovlig sendetilgang. Dette kan være e-postleverandøren din eller en transaksjonell e-posttjeneste. Tilgangsopplysninger skal aldri legges i nettsidekoden.

Legg disse som miljøvariabler på serveren (se `.env.example` for navn):

- `SMTP_HOST` – SMTP-serverens vertsnavn
- `SMTP_PORT` – vanligvis 587
- `SMTP_SECURE` – `false` ved STARTTLS/587 eller `true` ved TLS/465
- `SMTP_USER` og `SMTP_PASS` – brukernavn og SMTP-passord
- `SMTP_FROM` – gyldig avsenderadresse hos leverandøren

Mottakeradressen er allerede låst i serverkoden til **mrkassimaja@gmail.com**. Hvis SMTP ikke er konfigurert, lagres bestillinger uansett, og du ser `venter` under e-poststatus i administrasjonen. Der kan du sende varsel på nytt når SMTP virker.

## Viktig før offentlig lansering

- Publiser på en hostingtjeneste som støtter Node.js og **vedvarende disk/databaselagring**. Ikke bruk kortvarig filsystem (ephemeral storage) for SQLite. Ta automatisk sikkerhetskopi av databasen.
- Bruk **HTTPS** og en lang, unik `ADMIN_KEY` som hemmelig miljøvariabel hos hosten, ikke i kildekoden. Adminsiden selv er offentlig, men alle admin-API-endepunktene krever nøkkelen.
- Sett opp e-postvarsling og test med en liten bestilling. Kontroller at varselet kommer frem, og at eventuelt spamfilter tillater avsender.
- Publiser salgsbetingelser, personvernerklæring, informasjon om angrerett og selgeridentitet før ordinært salg; sjekk at ordrebekreftelse og opplysningsplikter overholdes. Kundedata lagres i databasen og må beskyttes, slettes etter en fastsatt rutine og håndteres i henhold til personvernregelverket.
- Serveren har enkel hastighetsbegrensning, men du bør bruke profesjonell hosting med ytterligere spam- og misbruksbeskyttelse. Hold programvare oppdatert.
- Registrering av ordre reserverer/trekker lager direkte, selv om Vippskrav ikke er betalt. Kanseller ubetalte ordre manuelt for å frigjøre lager.
- Automatisk e-post til kunden er implementert, men forutsetter fungerende SMTP-oppsett og vellykket sending. Test og overvåk e-poststatus før ordinært salg.

## Testing

`npm test` prøver ekte HTTP-kall mot en testdatabase og sjekker lagerfratrekk, overbooking og kansellering. Den sender ingen e-post.


## Nytt i denne versjonen
- Kunden får automatisk e-post med ordrenummer, kjøpte varer, sum, 50 kr porto, betalingsinformasjon, salgsbetingelser og personvernerklæring når SMTP er satt opp.
- Selger får separat varsel på `mrkassimaja@gmail.com`.
- Begge e-posters status vises i admin. Trykk «Send begge e-postene på nytt» ved feil. Merk at dette kan gi duplikater dersom leverandøren mottok e-posten men svaret forsvant.
- Rediger salgsbetingelser og personvern i admin. Innholdet lagres i databasen, ikke bare i nettleseren.

## Hosting fra bunnen av – eksempel med Render
1. Lag konto hos GitHub og Render. Opprett et **privat** GitHub-repository med innholdet i denne ZIP-filen (ikke `.env` eller `data/`).
2. Opprett en betalt **Web Service** på Render koblet til repositoryet, Node.js-runtime, Build Command `npm install` og Start Command `npm start`.
3. Legg til **persistent disk** med mount path `/var/data` og miljøvariabel `DATABASE_PATH=/var/data/butikk.sqlite`. Disk er nødvendig; ellers mister SQLite ordre og lager ved omstart/utrulling. Ikke kjør flere instanser mot samme SQLite-fil.
4. Sett `ADMIN_KEY` til en unik, tilfeldig hemmelig streng på minst 20 tegn. Sett `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` som miljøvariabler fra en transaksjonell e-postleverandør eller SMTP-tjeneste. Ikke del disse nøklene med andre.
5. Opprett og verifiser et avsenderdomene hos e-postleverandøren, inkludert SPF/DKIM etter leverandørens anvisninger. Test e-post både til selger og kunde. Gmail-adressen er **mottakeradresse**, ikke nødvendigvis avsender.
6. På Render får du en HTTPS-adresse. Når alt er testet, koble eget domenenavn ved å følge Render sine DNS-anvisninger hos domeneregistraren.
7. Åpne `/admin`, logg inn med ADMIN_KEY, legg inn lagerantall og pris for album, pakker og merker, samt komplett juridisk selgerinformasjon i salgsbetingelser/personvern.
8. Gjør en testbestilling. Kontroller at begge e-poster kommer frem, lageret synker, Vipps-krav sendes manuelt og kansellering gjenoppretter lageret.
9. Ta regelmessig sikkerhetskopi av den persistente databasen. Kontroller sikkerhet, håndtering av personopplysninger og lovpålagt angrerettsinformasjon før offentlig lansering.

**Juridisk merknad:** Standardtekstene er korte utkast med nødvendige utfyllingsfelter. De er ikke fullstendig tilpasset virksomheten. En selger må identifiseres med reelle kontakt- og registreringsopplysninger. Ved fjernsalg må kunden få lovpålagt informasjon om blant annet angrerett og et standard angrerettskjema der dette gjelder. Kontroller at virksomheten er korrekt registrert og at alle krav til personvern, bokføring, markedsføring og forbrukerkjøp er oppfylt før lansering.

## Salg som privatperson – viktig før publisering
- Det er **ikke lagt inn organisasjonsnummer** eller oppdiktet firmanavn. Selgernavn og postadresse er lagt inn i standardtekstene. Kontroller øvrige opplysninger i admin før publisering.
- Hvis du selger varer fortløpende gjennom nettbutikk for å tjene penger, kan aktiviteten bli vurdert som **næringsvirksomhet selv om du ikke har registrert foretak**. Avklar dette med Skatteetaten/Altinn; reglene avgjøres av aktivitetens art, omfang, varighet og overskuddsmulighet.
- Ikke skriv automatisk «ingen angrerett fordi privatperson». Hvis du i realiteten handler som næringsdrivende, kan blant annet angrerettloven og forbrukerkjøpsloven gjelde. Sørg i så fall for riktig forhåndsinformasjon og angrerettskjema.
- Standardtekstene er korte **utkast** som må gjennomgås og fullføres før første salg. De kan endres under `/admin` og vises til alle kunder.
- Salgsbetingelser som allerede er lagret i en eksisterende database blir **ikke automatisk overskrevet** av de nye standardtekstene. Rediger dem i admin dersom butikken er startet før.

## Selgeridentitet
Navnet **Ståle Edstrøm** er lagt inn i standardtekstene. Postadresse er **Østagrenda 187, 2484 Rendalen**. Hvis standardtekstene allerede ligger i en eksisterende database, beholdes disse inntil de endres via admin.


## Oppdatert selgeradresse
Ståle Edstrøm, Østagrenda 187, 2484 Rendalen.
Ved gjenbruk av en eksisterende database må vilkår og personvernerklæring oppdateres i admin fordi lagrede tekster ikke overskrives automatisk.
