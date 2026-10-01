# NORA — componente SVG, Dark + Light

Fiecare componentă este într-un SVG separat. Deschide index.html pentru catalogul complet; preview.svg arată cele cinci ecrane în ambele teme.

## Structură
- dark/ și light/: icons, icons-active, branding, voice, buttons, controls, navigation, home, activity, calendar, memory, profile, notifications, surfaces, system, screens
- manifest.json: fișier, dimensiuni native și temă pentru fiecare componentă
- design-tokens.json: palete, dimensiuni și raze

## Fidelitate și limite
Reconstrucție vectorială manuală după imaginea furnizată, nu fișierele originale de design. Geometria, spațierea, fontul, reflexiile și pictogramele sunt aproximări. Nu reprezintă o copie garantată 100% la nivel de pixel. Tema Light a ecranelor este derivată din Dark: în referință doar notificările au o variantă Light. Pictogramele ilustrative/emoji sunt redesenate ca vectori și vor diferi de original. Copiat textul „Conversioni” din referință, fără corectare editorială.

## Transparență
SVG-urile nu au un fundal global, exceptând ecranele complete și suprafețele desemnate. Cardurile/butoanele își păstrează propria suprafață. Orb-ul păstrează aura transparentă. Toate fișierele sunt vectoriale, fără imagini raster încorporate.

## Integrare
SVG: width/height sau CSS pentru redimensionare; păstrează viewBox. Textul este convertit în contururi pentru afișare identică fără instalarea fontului. Pentru traducere, accesibilitate și date dinamice, recreează textele în UI și folosește icons/ + surfaces/. SVG-urile nu implementează interacțiuni. Dacă lipești mai multe SVG-uri direct în DOM, prefixează id-urile din defs și referințele url(#...) pentru a evita coliziunile; folosirea prin img src nu are această problemă.

Notificările sunt mockup-uri de design. Notificările push reale sunt desenate de sistemul iOS/Android și nu pot fi controlate integral prin aceste SVG-uri.
